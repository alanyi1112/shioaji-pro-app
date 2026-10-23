import {describe,it,expect} from 'vitest';
import {createMarketCalendar,marketCalendarDay,adjacentMarketDate,marketDatasetExpectation,auditCalendarCandles,
    type ClosureState,type AnnualCalendar} from './market-calendar';
const now=new Date('2026-10-23T22:00:00+08:00');
const empty:ClosureState={available:true,revision:0,hash:null,entries:[],liveHolds:[]};
const annual:AnnualCalendar={verified:true,calendarVersion:'fixture-year',fetchedAtEpochMs:+now-1000,validUntilEpochMs:+now+100000,
    days:Array.from({length:10},(_,i)=>({tradeDate:`2026-10-${String(20+i).padStart(2,'0')}`,
        TSE:[24,25].includes(20+i)?'closed':'scheduled_trading',OTC:[24,25].includes(20+i)?'closed':'scheduled_trading'}))};
const closed:ClosureState={...empty,revision:1,hash:'a'.repeat(64),entries:[{date:'2026-10-23',markets:['TSE','OTC'],reason:'颱風',revision:1,recordedAt:now.toISOString(),source:'local_user'}]};
const calendar=createMarketCalendar(annual,closed,now);
describe('純共用日曆',()=>{
    it('人工全日休市不冒稱官方／沒有輸入不能推論開市',()=>{
        expect(marketCalendarDay(calendar,'2026-10-23','TSE',now)).toMatchObject({state:'closed',source:'local_user'});
        expect(marketCalendarDay(createMarketCalendar(null,empty,now),'2026-10-22','TSE',now).state).toBe('unknown');
    });
    it('單市場不影響另一市場、無強制開市',()=>{
        const c=createMarketCalendar(annual,{...closed,entries:closed.entries.map(e=>({...e,markets:['OTC']}))},now);
        expect(marketCalendarDay(c,'2026-10-23','TSE',now).state).toBe('scheduled');
        expect(marketCalendarDay(c,'2026-10-23','OTC',now).state).toBe('closed');
        expect(marketCalendarDay(c,'2026-10-24','TSE',now).state).toBe('closed');
    });
    it('缺來源、過期、未來觀測與缺範圍維持 unknown，不延效',()=>{
        for(const a of [null,{...annual,validUntilEpochMs:+now},{...annual,fetchedAtEpochMs:+now+1}])
            expect(marketCalendarDay(createMarketCalendar(a,empty,now),'2026-10-22','TSE',now).state).toBe('unknown');
        expect(marketCalendarDay(calendar,'2027-01-01','TSE',now).state).toBe('unknown');
    });
    it('設定不可驗時，即使 annual 合法仍阻擋',()=>{
        expect(marketCalendarDay(createMarketCalendar(annual,{...empty,available:false},now),'2026-10-22','TSE',now).state).toBe('unknown');
    });
    it('prev／next 共同交易日跳過休市，不跨未證範圍猜日期',()=>{
        expect(adjacentMarketDate(calendar,'2026-10-22','next',undefined,now).date).toBe('2026-10-26');
        expect(adjacentMarketDate(calendar,'2026-10-26','previous',undefined,now).date).toBe('2026-10-22');
        expect(adjacentMarketDate(calendar,'2026-10-29','next',undefined,now).date).toBeNull();
    });
    it('版本包含年度與人工 revision；舊 complete 不能共用身分',()=>{
        expect(calendar.version).not.toBe(createMarketCalendar(annual,empty,now).version);
        expect(calendar.version).not.toBe(createMarketCalendar({...annual,calendarVersion:'other'},closed,now).version);
        expect(calendar.automaticRepairAllowed).toBe(false);
    });
});
describe('日報及週期資料',()=>{
    const check=(dataDate:string,dataset:string,extra={})=>marketDatasetExpectation({calendar,market:'TSE',dataDate,dataset,observation:{present:false},now,...extra});
    it('當天休市不排除前一資料日缺件',()=>{
        expect(check('2026-10-23','institutional-flow').state).toBe('not_expected');
        expect(check('2026-10-22','institutional-flow').state).toBe('missing');
    });
    it('法人／資券保留各自原發布窗口',()=>{
        const n=new Date('2026-10-22T18:00:00+08:00'),c=createMarketCalendar({...annual,fetchedAtEpochMs:+n-1000,validUntilEpochMs:+n+86400000},empty,n);
        expect(marketDatasetExpectation({calendar:c,market:'TSE',dataDate:'2026-10-22',dataset:'institutional-flow',observation:{present:false},now:n}).state).toBe('missing');
        expect(marketDatasetExpectation({calendar:c,market:'TSE',dataDate:'2026-10-22',dataset:'margin-short',observation:{present:false},now:n}).state).toBe('pending');
    });
    it('休市卻有資料列 conflict，不掩蓋資料錯誤',()=>{
        expect(check('2026-10-23','daily-candle',{observation:{present:true,verified:true,sourceDate:'2026-10-23'}}).state).toBe('conflict');
    });
    it('日期錯／未驗證／來源錯誤不變成 available',()=>{
        expect(check('2026-10-22','margin-short',{observation:{present:true,verified:true,sourceDate:'2026-10-21'}}).state).toBe('conflict');
        expect(check('2026-10-22','margin-short',{observation:{present:true,verified:false,sourceDate:'2026-10-22'}}).state).toBe('unknown');
        expect(check('2026-10-22','margin-short',{observation:{present:false,reason:'provider_unavailable'}}).state).toBe('unknown');
    });
    it('週報有獨立期別，休市不刪整週，不猜改到下一週',()=>{
        expect(check('2026-10-23','tdcc-weekly').state).toBe('unknown');
        const weeklyContract={verified:true,sourceVersion:'fixture-week-policy',expectedDates:['2026-10-23'],releaseAt:'2026-10-23T20:00:00+08:00'};
        expect(check('2026-10-23','tdcc-weekly',{weeklyContract}).state).toBe('missing');
        expect(check('2026-10-23','tdcc-weekly',{weeklyContract:{...weeklyContract,releaseAt:'2026-10-24T20:00:00+08:00'}}).state).toBe('pending');
        expect(check('2026-10-23','tdcc-weekly',{weeklyContract:{...weeklyContract,verified:false}}).state).toBe('unknown');
    });
});
describe('唯讀 K 棒檢查',()=>{
    it('盤中移動中的日 K 不是已完成 session，不以有一根就 complete',()=>{
        const n=new Date('2026-10-22T10:00:00+08:00'),c=createMarketCalendar({...annual,fetchedAtEpochMs:+n-1000,validUntilEpochMs:+n+86400000},empty,n);
        expect(auditCalendarCandles({calendar:c,market:'TSE',from:'2026-10-22',through:'2026-10-22',rows:[{date:'2026-10-22'}],now:n}).status).toBe('pending');
    });
    it('休市排除與真缺棒分開，完全沒有修復資料／請求',()=>{
        const result=auditCalendarCandles({calendar,market:'TSE',from:'2026-10-21',through:'2026-10-23',rows:[{date:'2026-10-21'}],now});
        expect(result.status).toBe('partial');expect(result.excluded).toEqual(['2026-10-23']);expect(result.missing).toEqual(['2026-10-22']);
        expect(result.requests).toBe(0);expect(result.repairRows).toEqual([]);
    });
    it('完整根數不能蓋掉休市日有成交的矛盾',()=>{
        expect(auditCalendarCandles({calendar,market:'TSE',from:'2026-10-23',through:'2026-10-23',rows:[{date:'2026-10-23'}],now}).status).toBe('conflict');
    });
    it('分 K 必須逐分鐘／邊界完整，不能只看根數',()=>{
        const rows=Array.from({length:270},(_,i)=>({date:'2026-10-22',minute:540+i}));
        expect(auditCalendarCandles({calendar,market:'TSE',from:'2026-10-22',through:'2026-10-22',rows,interval:'1m',now}).status).toBe('complete');
        rows[0]!.minute=999;
        expect(auditCalendarCandles({calendar,market:'TSE',from:'2026-10-22',through:'2026-10-22',rows,interval:'1m',now}).status).toBe('partial');
    });
});
