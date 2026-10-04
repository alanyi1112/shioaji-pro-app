import { prepareBollingerCalendarExceptions, closureSourceUrl } from '../../../../scripts/stock-screener-calendar-exceptions.ts';
// 純隔離公告 fixture，禁止送真實網路或作正式休市證據。
export const emptyNotices = async year => ({ sourceUrl: closureSourceUrl(year), status: 200,
    text: JSON.stringify({ stat: 'ok', fields: ['項次','標題','日期','zhId','enId'], data: [], totalCount: 0 }) });
export const installNoticeFixture = (db, calendar, now) => prepareBollingerCalendarExceptions(db, calendar,
    { now, deadline: now().getTime() + 900000, fetchNotices: emptyNotices });
