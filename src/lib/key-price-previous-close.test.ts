import { describe, it, expect, vi } from 'vitest';
import { resolvePreviousClose, resolveSupportReferenceClose, resolveLastDailyChartClose, keyPricePercent, type KeyPricePercentContext } from './key-price-previous-close';
import { createMarketCalendar } from './market-calendar';
import { DailyIndicatorAuthority, dailyProductKey } from './daily-indicator-authority';
import type { DailyLevelSnapshot } from './daily-indicator-levels';
import type { ContractInfo } from './types/contract';
const now = new Date('2026-10-31T10:00:00+08:00');
const contract = { code: '2330', security_type: 'STK', region: 'TW', exchange: 'TSE', reference: 95 } as ContractInfo;
const key = dailyProductKey(contract);
const seconds = (d: string) => Date.parse(d + 'T00:00:00Z') / 1000;
const bar = (d: string, close: number) => ({ time: seconds(d), open: close, high: close, low: close, close, volume: 1, turnoverTwd: null });
const calendar = createMarketCalendar({ verified: true, calendarVersion: 'fixture', fetchedAtEpochMs: +now - 86400000,
    validUntilEpochMs: +now + 10 * 86400000, days: ['2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01','2026-11-02'].map(d => ({ tradeDate: d, TSE: d === '2026-10-31' || d === '2026-11-01' ? 'closed' : 'scheduled_trading', OTC: 'scheduled_trading' })) },
    { available: true, revision: 0, hash: null, entries: [], liveHolds: [] }, now);
const snapshot: DailyLevelSnapshot = { key, bars: [bar('2026-10-28', 97),bar('2026-10-29', 100), bar('2026-10-30', 103)],
    generation: 4, state: 'ready', phase: 'closed', asOf: seconds('2026-10-30') + 48600, receivedAt: seconds('2026-10-30') + 49000 };
export const percentFixture: KeyPricePercentContext = { baseline: resolvePreviousClose({key,snapshot,calendar,market:'TSE',now}), up: '#ff0000', down: '#00ff00', neutral: '#777777' };
describe('關鍵價位實際昨收（離線合成來源）', () => {
    it('費波取實際日K序列最後close103，不取前日100或錨點；無前綴、更新與非法身分',()=>{
        const input={key,identity:'2330|1440',expectedIdentity:'2330|1440',minutes:1440,bars:snapshot.bars,available:true};
        const b=resolveLastDailyChartClose(input),context={...percentFixture,baseline:b,prefix:''};
        expect(b).toMatchObject({date:'2026-10-30',close:103,reason:null});
        expect(keyPricePercent(105,context).text).toBe('+1.94%');
        expect(keyPricePercent(103,context).text).toBe('0.00%');
        expect(resolveLastDailyChartClose({...input,bars:[...snapshot.bars.slice(0,-1),bar('2026-10-30',104)]}).close).toBe(104);
        for(const close of [0,-1,NaN,Infinity])expect(resolveLastDailyChartClose({...input,bars:[bar('2026-10-30',close)]}).close).toBeNull();
        const unknown=resolveLastDailyChartClose({...input,identity:'2317|1440'});
        expect(keyPricePercent(105,{...context,baseline:unknown}).text).toBe('—');
        expect(resolveLastDailyChartClose({...input,minutes:5}).close).toBeNull();
        expect(resolveLastDailyChartClose({...input,available:false}).close).toBeNull();
    });
    it('三套壓撐使用被選參考K的close，與費波的實際昨收分開；非法或錯商品未知',()=>{
        const reference={date:'2026-10-20',high:110,low:90,close:95,firstTime:1,lastTime:2,status:'completed' as const,mode:'pinned' as const};
        const b=resolveSupportReferenceClose('STK|TSE|2330',{key:'STK|TSE|2330',reference,pinned:true});
        expect(b).toMatchObject({referenceDate:'2026-10-20',close:95,reason:null});
        expect(keyPricePercent(105,{...percentFixture,baseline:b}).text).toBe('較昨收 +10.53%');
        expect(keyPricePercent(105,percentFixture).text).toBe('較昨收 +5.00%');
        for(const close of [0,-1,NaN,Infinity]) expect(resolveSupportReferenceClose(b.key,{key:b.key,reference:{...reference,close},pinned:true}).close).toBeNull();
        expect(resolveSupportReferenceClose('STK|TSE|2317',{key:b.key,reference,pinned:true}).close).toBeNull();
    });
    it('週末沿用已確認T/P，除權息reference95不冒充實際昨收100', () => {
        expect(percentFixture.baseline).toMatchObject({tradeDate:'2026-10-30',previousDate:'2026-10-29',close:100,reason:null});
        expect(keyPricePercent(105,percentFixture).text).toBe('較昨收 +5.00%');
        expect(keyPricePercent(97,percentFixture).text).toBe('較昨收 −3.00%');
        expect(keyPricePercent(100,percentFixture).text).toBe('較昨收 0.00%');
        expect(keyPricePercent(99.9999,percentFixture).text).toBe('較昨收 0.00%');
        expect(keyPricePercent(112,percentFixture).text).toBe('較昨收 +12.00%');
        expect(keyPricePercent(102.5,percentFixture).text).toBe('較昨收 +2.50%');
        expect(keyPricePercent(100.0049,percentFixture).text).toBe('較昨收 0.00%');
        expect(keyPricePercent(100.006,percentFixture).text).toBe('較昨收 +0.01%');
        expect(keyPricePercent(Number((100.006).toFixed(0)),percentFixture).text).toBe('較昨收 0.00%');
    });
    it('缺日不退回更早日、零負非有限昨收與錯誤身分／世代皆未知', () => {
        const resolve = (s: DailyLevelSnapshot) => resolvePreviousClose({key,snapshot:s,calendar,market:'TSE',now});
        for (const close of [0,-1,NaN,Infinity]) expect(resolve({...snapshot,bars:[bar('2026-10-29',close),bar('2026-10-30',103)]}).close).toBeNull();
        expect(resolve({...snapshot,bars:[bar('2026-10-28',97),bar('2026-10-30',103)]}).reason).toContain('缺少');
        expect(resolve({...snapshot,bars:[bar('2026-10-30',103)]}).close).toBeNull();
        expect(resolve({...snapshot,key:'wrong-adjusted'}).close).toBeNull();
        expect(resolve({...snapshot,state:'stale'}).close).toBeNull();
        expect(resolve({...snapshot,knownGap:true}).close).toBeNull();
        expect(resolve({...snapshot,receivedAt:-1}).close).toBeNull();
        expect(resolve({...snapshot,bars:[bar('2026-10-29',100),{...bar('2026-10-30',103),time:1e300}]}).close).toBeNull();
        expect(resolvePreviousClose({key,snapshot,calendar,market:'TSE',now,minimumGeneration:5}).close).toBeNull();
        expect(resolvePreviousClose({key,snapshot,calendar,market:'TSE',now:new Date('2026-11-02T10:00:00+08:00')}).close).toBeNull();
    });
    it('人工休市跳過P，失效日曆不偷用相鄰觀測列', () => {
        const closed={...calendar,closures:{...calendar.closures,revision:1,entries:[{date:'2026-10-29',markets:['TSE' as const],reason:'fixture休市',revision:1,recordedAt:now.toISOString(),source:'local_user' as const}]}};
        const result=resolvePreviousClose({key,snapshot,calendar:closed,market:'TSE',now});
        expect(result).toMatchObject({previousDate:'2026-10-28',close:97});
        const stale={...calendar,annual:{...calendar.annual!,validUntilEpochMs:+now-1}};
        expect(resolvePreviousClose({key,snapshot,calendar:stale,market:'TSE',now}).close).toBeNull();
    });
    it('真實新T換P，休市依日曆跳過，未知不得輸出假百分比', () => {
        const newer = resolvePreviousClose({key,snapshot:{...snapshot,asOf:seconds('2026-11-02')+9*3600,receivedAt:seconds('2026-11-02')+10*3600,bars:[...snapshot.bars,bar('2026-11-02',104)]},calendar,market:'TSE',now:new Date('2026-11-02T10:00:00+08:00')});
        expect(newer).toMatchObject({tradeDate:'2026-11-02',previousDate:'2026-10-30',close:103});
        const missing = resolvePreviousClose({key,snapshot,calendar:null,market:'TSE',now});
        expect(keyPricePercent(105,{...percentFixture,baseline:missing}).text).toBe('較昨收 —');
    });
    it('被動觀察不下載，不取消原需求；商品更換不接受前商品回應', async () => {
        const load = vi.fn(), authority = new DailyIndicatorAuthority(load, () => seconds('2026-10-31'));
        const notify = vi.fn(), stop = authority.observe(contract,notify);
        await Promise.resolve(); expect(load).not.toHaveBeenCalled();
        authority.publish(contract,snapshot.bars); expect(notify.mock.calls.at(-1)![0].bars).toHaveLength(3);
        const other = {...contract,code:'2317'}, otherNotify = vi.fn(); authority.observe(other,otherNotify);
        authority.publish(contract,[bar('2026-10-30',104)]); expect(otherNotify).toHaveBeenCalledTimes(1);
        stop(); await Promise.resolve(); expect(load).not.toHaveBeenCalled();
    });
});
