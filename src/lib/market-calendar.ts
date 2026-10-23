/** 共用純核心：不讀檔、不連 DB、不發出請求、不產生或修復資料。 */
export type CalendarMarket = 'TSE' | 'OTC';
export type ClosureEntry = { date: string; markets: CalendarMarket[]; reason: string;
    revision: number; recordedAt: string; source: 'local_user' };
export type ClosureState = { available: boolean; revision: number; hash: string | null;
    entries: ClosureEntry[]; liveHolds: {date: string; markets: CalendarMarket[]}[] };
export type AnnualCalendar = { verified: boolean; calendarVersion: string; fetchedAtEpochMs: number;
    validUntilEpochMs: number; days: {tradeDate: string; TSE: string; OTC: string}[] };
export type MarketCalendar = { schemaVersion: 'shared-local-market-calendar/1'; annual: AnnualCalendar | null;
    closures: ClosureState; version: string; observedAt: string; automaticRepairAllowed: false };
export type LocalCalendarCheck = {symbol:string; from:string; through:string; dataset:string; interval:string};
export function validLocalCalendarCheck(value:unknown): value is LocalCalendarCheck {
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const q=value as LocalCalendarCheck;
    return Object.keys(q).sort().join(',')==='dataset,from,interval,symbol,through' &&
        /^(?:\d{4,6}[A-Z]?)\.(?:TW|TWO)$/.test(q.symbol) && realCalendarDate(q.from) && realCalendarDate(q.through) &&
        q.through>=q.from && Date.parse(q.through)-Date.parse(q.from)<=366*86400000 &&
        ['candles','institutional-flow','margin-short','tdcc-weekly'].includes(q.dataset) &&
        ['1d','1m','5m','15m','1h'].includes(q.interval) &&
        (q.dataset==='candles' ? q.interval==='1d'||Date.parse(q.through)-Date.parse(q.from)<=6*86400000 : q.from===q.through);
}
export const realCalendarDate = (value: unknown): value is string => typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
export const taipeiCalendarDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',
}).format(now);
export function validClosureState(value: ClosureState | undefined): value is ClosureState {
    return value?.available === true && Number.isSafeInteger(value.revision) && value.revision>=0 &&
        (value.hash===null || /^[a-f0-9]{64}$/.test(value.hash)) && Array.isArray(value.entries) && value.entries.length<=2048 &&
        value.entries.every(e=>!!e&&realCalendarDate(e.date)&&Array.isArray(e.markets)&&e.markets.length>0&&e.markets.length<=2&&
            new Set(e.markets).size===e.markets.length&&e.markets.every(m=>['TSE','OTC'].includes(m))) &&
        new Set(value.entries.flatMap(e=>e.markets.map(m=>`${e.date}/${m}`))).size===value.entries.reduce((n,e)=>n+e.markets.length,0) &&
        Array.isArray(value.liveHolds)&&value.liveHolds.length<=2048&&value.liveHolds.every(h=>!!h&&realCalendarDate(h.date)&&
            Array.isArray(h.markets)&&h.markets.length>0&&h.markets.every(m=>['TSE','OTC'].includes(m)));
}
export function createMarketCalendar(annual: AnnualCalendar | null, closures: ClosureState, now = new Date()): MarketCalendar {
    return {schemaVersion:'shared-local-market-calendar/1',annual,closures,
        version:`${annual?.calendarVersion ?? 'annual-unknown'}|manual:${closures.revision}:${closures.hash ?? 'none'}`,
        observedAt:now.toISOString(),automaticRepairAllowed:false};
}
export function marketCalendarDay(calendar: MarketCalendar, date: string, market: CalendarMarket, now = new Date()) {
    const unknown = (reason: string) => ({state:'unknown' as const,reason,source:'unknown',version:calendar?.version ?? 'unknown'});
    if (!realCalendarDate(date) || !['TSE','OTC'].includes(market) || !calendar ||
        calendar.schemaVersion !== 'shared-local-market-calendar/1' || !validClosureState(calendar.closures) || !Number.isFinite(+now)) return unknown('calendar_settings_unavailable');
    const special = calendar.closures.entries.find(e => e.date === date && e.markets.includes(market));
    if (special) return {state:'closed' as const,reason:'user_special_market_closure',source:'local_user',version:calendar.version};
    const a = calendar.annual;
    if (!a?.verified || !Number.isFinite(a.fetchedAtEpochMs) || !Number.isFinite(a.validUntilEpochMs) ||
        +now < a.fetchedAtEpochMs || +now >= a.validUntilEpochMs || !Array.isArray(a.days)||a.days.length>740) return unknown('annual_calendar_unavailable_or_stale');
    const rows = a.days.filter(d => d?.tradeDate === date);
    if (rows.length !== 1) return unknown('calendar_date_uncovered');
    const state = rows[0]?.[market];
    if (state === 'closed') return {state:'closed' as const,reason:'annual_non_trading_date',source:'annual_calendar',version:calendar.version};
    if (state !== 'scheduled_trading') return unknown('calendar_state_invalid');
    return {state:'scheduled' as const,reason:null,source:'annual_calendar',version:calendar.version};
}
export function adjacentMarketDate(calendar: MarketCalendar, date: string, direction: 'previous'|'next',
    markets: CalendarMarket[] = ['TSE','OTC'], now = new Date()) {
    if (!realCalendarDate(date) || !['previous','next'].includes(direction) || !markets.length ||
        markets.some(m => !['TSE','OTC'].includes(m))) return {date:null,reason:'calendar_input_invalid',version:calendar.version};
    let at = Date.parse(`${date}T00:00:00Z`);
    for (let i=0;i<370;i++) {
        at += (direction === 'next' ? 1 : -1) * 86400000;
        const candidate = new Date(at).toISOString().slice(0,10);
        const states = markets.map(m => marketCalendarDay(calendar,candidate,m,now));
        if (states.some(s => s.state === 'unknown')) return {date:null,reason:'adjacent_calendar_unconfirmed',version:calendar.version};
        if (states.every(s => s.state === 'scheduled')) return {date:candidate,reason:null,version:calendar.version};
    }
    return {date:null,reason:'calendar_search_limit',version:calendar.version};
}
export type DatasetObservation = {present: boolean; verified?: boolean; sourceDate?: string | null; reason?: string | null};
export function marketDatasetExpectation({calendar,market,dataDate,dataset,observation,now = new Date(),weeklyContract}:
    {calendar:MarketCalendar;market:CalendarMarket;dataDate:string;dataset:string;observation:DatasetObservation;
        now?:Date;weeklyContract?:{expectedDates:string[];releaseAt:string;verified:boolean;sourceVersion:string}}) {
    const result = (state:string,reason:string|null,expected:boolean|null) => ({state,reason,expected,
        dataDate,market,dataset,calendarVersion:calendar?.version??'unknown',automaticRepairAllowed:false as const});
    if (!realCalendarDate(dataDate) || !Number.isFinite(+now) || !['TSE','OTC'].includes(market)||!validClosureState(calendar?.closures) || typeof observation?.present!=='boolean') return result('unknown','calendar_settings_unavailable',null);
    let release: number;
    if (dataset === 'tdcc-weekly') {
        if (!weeklyContract || weeklyContract.verified!==true || !weeklyContract.sourceVersion || !Array.isArray(weeklyContract.expectedDates) || !weeklyContract.expectedDates.every(realCalendarDate) ||
            !weeklyContract.expectedDates.includes(dataDate) || !Number.isFinite(Date.parse(weeklyContract.releaseAt))) return result('unknown','weekly_period_contract_missing',null);
        release = Date.parse(weeklyContract.releaseAt);
    } else {
        if (!['daily-candle','intraday-candle','institutional-flow','margin-short'].includes(dataset)) return result('unknown','dataset_contract_missing',null);
        const day = marketCalendarDay(calendar,dataDate,market,now);
        if (day.state === 'unknown') return result('unknown',day.reason,null);
        if (day.state === 'closed') return observation.present ? result('conflict','data_on_closed_market_date',false) : result('not_expected',day.reason,false);
        const time = dataset === 'institutional-flow' ? '16:00' : dataset === 'margin-short' ? '21:00' : '13:35';
        release = Date.parse(`${dataDate}T${time}:00+08:00`);
    }
    if (observation.present && observation.sourceDate !== dataDate) return result('conflict','source_data_date_mismatch',true);
    if (observation.present && observation.verified !== true) return result('unknown',observation.reason ?? 'data_not_verified',true);
    if (observation.present && dataDate>taipeiCalendarDate(now)) return result('unknown','future_source_data_date',true);
    if (observation.present && ['daily-candle','intraday-candle'].includes(dataset) && +now<release) return result('pending','session_not_closed',true);
    if (observation.present) return result('available',null,true);
    if (+now < release) return result('pending','publication_window_pending',true);
    return observation.reason ? result('unknown',observation.reason,true) : result('missing','expected_data_missing',true);
}
export function auditCalendarCandles({calendar,market,from,through,rows,interval='1d',now=new Date()}:
    {calendar:MarketCalendar;market:CalendarMarket;from:string;through:string;
        rows:{date:string;minute?:number;valid?:boolean}[];interval?:string;now?:Date}) {
    const missing:string[]=[],excluded:string[]=[],conflicts:string[]=[],unknown:string[]=[],pending:string[]=[];
    if (!realCalendarDate(from) || !realCalendarDate(through) || through < from ||
        Date.parse(through)-Date.parse(from)>3660*86400000 || !['1d','1m','5m','15m','1h'].includes(interval))
        return {status:'unknown',reason:'calendar_scope_invalid',calendarVersion:calendar.version,missing,excluded,conflicts,unknown,pending,requests:0,repairRows:[]};
    const contract:Record<string,{step:number;last:number;count:number}>= {'1m':{step:1,last:809,count:270},'5m':{step:5,last:805,count:54},
        '15m':{step:15,last:795,count:18},'1h':{step:60,last:780,count:5}};
    for(let at=Date.parse(from);at<=Date.parse(through);at+=86400000) {
        const date=new Date(at).toISOString().slice(0,10),items=rows.filter(r=>r.date===date);
        const observation={present:items.length>0,sourceDate:date,verified:items.every(r=>r.valid!==false)};
        const decision=marketDatasetExpectation({calendar,market,dataDate:date,dataset:interval==='1d'?'daily-candle':'intraday-candle',observation,now});
        if(decision.state==='not_expected')excluded.push(date);
        else if(decision.state==='conflict')conflicts.push(date);
        else if(decision.state==='unknown')unknown.push(date);
        else if(decision.state==='pending')pending.push(date);
        else if(decision.state==='missing')missing.push(date);
        else if(interval==='1d'&&items.length!==1)unknown.push(date);
        else if(interval!=='1d') {
            const c=contract[interval]!,minutes=new Set(items.filter(r=>r.valid!==false).map(r=>r.minute));
            if(+now<Date.parse(`${date}T13:35:00+08:00`))pending.push(date);
            else if(items.length!==c.count || minutes.size!==c.count || Array.from({length:c.count},(_,i)=>540+i*c.step).some(m=>!minutes.has(m)))missing.push(date);
        }
    }
    const status=conflicts.length?'conflict':unknown.length?'unknown':missing.length?'partial':pending.length?'pending':'complete';
    return {status,reason:conflicts.length?'data_on_closed_market_date':unknown.length?'calendar_or_data_unconfirmed':missing.length?'missing_scheduled_session':pending.length?'publication_window_pending':null,
        calendarVersion:calendar.version,missing,excluded,conflicts,unknown,pending,requests:0,repairRows:[]};
}
