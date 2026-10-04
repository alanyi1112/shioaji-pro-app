/** 新能力獨立來源 mapping；來源契約未驗證，不允許正式匯入。 */
import { canonicalPriceUnits, canonicalVolumeShares, validateCanonicalOhlcv } from './stock-screener-ohlcv.ts';
import { technicalEvidenceHash } from './stock-screener-technical-patterns.ts';
import { SCREENER_V8_MAPPING_VERSION, type TurnoverOhlcv } from './stock-screener-v8.ts';
import type { ScreenerMarket } from './stock-screener-domain.ts';

export const validBollingerDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
    && Number.isFinite(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
export const bollingerSourceUrl = (market: ScreenerMarket, date: string) => {
    if (!validBollingerDate(date) || !['TWSE', 'TPEx'].includes(market)) throw new Error('invalid_source_target');
    return market === 'TWSE'
        ? `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${date.replaceAll('-', '')}&type=ALLBUT0999&response=json`
        : `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=${date.replaceAll('-', '%2F')}&id=&response=json`;
};
export interface BollingerSourceReview {
    status: 'verified'; market: ScreenerMarket; mappingVersion: typeof SCREENER_V8_MAPPING_VERSION;
    volumeUnit: 'shares'; turnoverUnit: 'TWD'; endpoint: string;
    usage: 'local-historical-screener'; evidenceHash: string; reviewedAt: string; validThrough: string;
    minimumRows: number;
}
export function validateBollingerSourceReview(r: BollingerSourceReview, market: ScreenerMarket, now: Date) {
    return r?.status === 'verified' && r.market === market && r.mappingVersion === SCREENER_V8_MAPPING_VERSION
        && r.volumeUnit === 'shares' && r.turnoverUnit === 'TWD' && r.usage === 'local-historical-screener'
        && r.endpoint === new URL(bollingerSourceUrl(market, '2026-01-01')).origin + new URL(bollingerSourceUrl(market, '2026-01-01')).pathname
        && /^[a-f0-9]{64}$/.test(r.evidenceHash) && Number.isFinite(Date.parse(r.reviewedAt))
        && Date.parse(r.reviewedAt) <= now.getTime() && Number.isFinite(Date.parse(r.validThrough))
        && Date.parse(r.validThrough) > now.getTime() && Number.isInteger(r.minimumRows) && r.minimumRows > 0 && r.minimumRows <= 10000;
}
export interface BollingerSourceResponse {
    text: string; fetchedAt: string; sourceUrl: string; status: number; retryAfter?: string | null;
}
export type BollingerReadiness = 'ready' | 'before_listing' | 'after_delisting' | 'suspended'
    | 'no_trade' | 'source_missing' | 'missing_ohlcv' | 'missing_volume' | 'missing_turnover';
export interface BollingerReportPoint {
    code: string; bar: TurnoverOhlcv | null; readiness: BollingerReadiness;
    sourceValues: { open: string | null; high: string | null; low: string | null; close: string | null;
        volumeShares: string | null; turnoverNtd: string | null };
}
export interface BollingerOfficialReport {
    market: ScreenerMarket; sessionDate: string; sourceUrl: string; fetchedAt: string; payloadHash: string;
    reviewHash: string; mappingVersion: typeof SCREENER_V8_MAPPING_VERSION;
    volumeUnit: 'shares'; turnoverUnit: 'TWD'; bytes: number; points: BollingerReportPoint[];
}
// 官方日報包含權證、ETF 等非策略商品；普通股母體上限不能當成原始日報列數上限。
// 2026-10-02 TPEx 日報實測 11,928 列；仍保留 8 MiB、schema、唯一代碼與有界列數檢查。
export const MAX_BOLLINGER_REPORT_ROWS = 20_000;
const numberString = (value: unknown): string | null => {
    if (typeof value !== 'string' || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/.test(value.trim())) return null;
    return value.trim().replaceAll(',', '').replace(/^0+(?=\d)/, '');
};
const amountString = (value: unknown) => {
    const n = numberString(value); return n !== null && /^(?:0|[1-9]\d{0,24})$/.test(n) ? n : null;
};

/** 只有官方指定日期、欄位與單位完全相符才回 market/date 終態。 */
export async function parseBollingerOfficialReport(response: BollingerSourceResponse, market: ScreenerMarket,
    sessionDate: string, review: BollingerSourceReview, now = new Date()): Promise<BollingerOfficialReport> {
    if (!validateBollingerSourceReview(review, market, now)) throw new Error('source_contract_pending');
    if (response.sourceUrl !== bollingerSourceUrl(market, sessionDate)
        || !Number.isFinite(Date.parse(response.fetchedAt)) || Date.parse(response.fetchedAt) > now.getTime() + 60000)
        throw new Error('invalid_source_provenance');
    if (response.status !== 200) throw new Error(`source_http_${response.status}`);
    const bytes = new TextEncoder().encode(response.text).byteLength;
    if (!bytes || bytes > 8 * 1024 * 1024) throw new Error('invalid_source_size');
    let payload;
    try { payload = JSON.parse(response.text); } catch { throw new Error('invalid_report_schema'); }
    if (payload.date !== sessionDate.replaceAll('-', '')) throw new Error('invalid_report_date');
    if (String(payload.stat).toLowerCase() !== 'ok') throw new Error('source_not_published');
    if (!Array.isArray(payload.tables)) throw new Error('invalid_report_schema');
    const codeField = market === 'TWSE' ? '證券代號' : '代號';
    const amountField = market === 'TWSE' ? '成交金額' : '成交金額(元)';
    const pricesFields = market === 'TWSE' ? ['開盤價', '最高價', '最低價', '收盤價'] : ['開盤', '最高', '最低', '收盤'];
    const fields = [codeField, '成交股數', amountField, ...pricesFields];
    const tables = payload.tables.filter((t: { fields?: string[] }) => Array.isArray(t.fields) && t.fields.includes(codeField));
    if (tables.length !== (market === 'TWSE' ? 1 : 2)) throw new Error('invalid_report_schema');
    let reportRows = 0;
    for (const table of tables) {
        if (!Array.isArray(table.data)) throw new Error('invalid_report_schema');
        reportRows += table.data.length;
        if (reportRows > MAX_BOLLINGER_REPORT_ROWS) throw new Error('invalid_report_universe');
    }
    const points: BollingerReportPoint[] = [];
    for (const table of tables) {
        if (!Array.isArray(table.data) || new Set(table.fields).size !== table.fields.length || fields.some(f => !table.fields.includes(f)))
            throw new Error('invalid_report_schema');
        const indexes = fields.map(f => table.fields.indexOf(f));
        for (const row of table.data) {
            if (!Array.isArray(row) || row.length !== table.fields.length || typeof row[indexes[0]] !== 'string'
                || !/^[A-Z0-9]{4,12}$/.test(row[indexes[0]])) throw new Error('invalid_report_schema');
            const code = row[indexes[0]], volumeShares = amountString(row[indexes[1]]), turnoverNtd = amountString(row[indexes[2]]);
            const prices = indexes.slice(3).map(i => numberString(row[i]));
            let readiness: BollingerReadiness = 'ready', bar: TurnoverOhlcv | null = null;
            if (volumeShares === '0') readiness = 'no_trade';
            else if (volumeShares === null || canonicalVolumeShares(volumeShares) === null) readiness = 'missing_volume';
            else if (prices.some(p => p === null || canonicalPriceUnits(p) === null)) readiness = 'missing_ohlcv';
            else {
                bar = { sessionDate, open: prices[0]!, high: prices[1]!, low: prices[2]!, close: prices[3]!, volumeShares, turnoverNtd };
                if (!validateCanonicalOhlcv(bar)) { readiness = 'missing_ohlcv'; bar = null; }
                else if (turnoverNtd === null) readiness = 'missing_turnover';
            }
            points.push({ code, bar, readiness, sourceValues: { open: prices[0]!, high: prices[1]!, low: prices[2]!, close: prices[3]!,
                volumeShares: canonicalVolumeShares(volumeShares) === null ? null : volumeShares, turnoverNtd } });
        }
    }
    if (!points.length) throw new Error('source_not_published');
    if (points.length < review.minimumRows || new Set(points.map(p => p.code)).size !== points.length)
        throw new Error('invalid_report_universe');
    const payloadHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(response.text))))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    return { market, sessionDate, sourceUrl: response.sourceUrl, fetchedAt: response.fetchedAt, payloadHash,
        reviewHash: review.evidenceHash, mappingVersion: SCREENER_V8_MAPPING_VERSION, volumeUnit: 'shares', turnoverUnit: 'TWD', bytes, points };
}
export interface BollingerUniverseStock {
    symbol: string; code: string; name: string; market: ScreenerMarket; listingDate: string | null;
    delistingDate?: string | null; suspendedSessions?: string[];
}
export function projectBollingerReport(report: BollingerOfficialReport, stocks: BollingerUniverseStock[]) {
    const points = new Map(report.points.map(p => [p.code, p]));
    return stocks.filter(s => s.market === report.market).map(stock => {
        const d = report.sessionDate, p = points.get(stock.code);
        const readiness: BollingerReadiness = stock.listingDate && d < stock.listingDate ? 'before_listing'
            : stock.delistingDate && d > stock.delistingDate ? 'after_delisting'
                : stock.suspendedSessions?.includes(d) ? 'suspended' : p?.readiness ?? 'source_missing';
        return { symbol: stock.symbol, market: stock.market, sessionDate: d, readiness,
            bar: readiness === 'ready' || readiness === 'missing_turnover' ? p!.bar : null,
            sourceValues: p?.sourceValues ?? null,
            provenance: { sourceUrl: report.sourceUrl, fetchedAt: report.fetchedAt, payloadHash: report.payloadHash,
                reviewHash: report.reviewHash, mappingVersion: report.mappingVersion, volumeUnit: report.volumeUnit, turnoverUnit: report.turnoverUnit } };
    });
}
export async function bollingerUniverseHash(stocks: BollingerUniverseStock[]) {
    if (!stocks.length || stocks.length > 10000 || new Set(stocks.map(s => s.symbol)).size !== stocks.length
        || stocks.some(s => !['TWSE', 'TPEx'].includes(s.market) || !/^[A-Z0-9]{4,12}$/.test(s.code)
            || s.symbol !== `${s.code}.${s.market === 'TWSE' ? 'TW' : 'TWO'}` || !s.name
            || s.listingDate !== null && !validBollingerDate(s.listingDate)
            || s.delistingDate != null && !validBollingerDate(s.delistingDate)
            || s.suspendedSessions?.some(d => !validBollingerDate(d)))) throw new Error('invalid_bollinger_universe');
    return technicalEvidenceHash([...stocks].sort((a, b) => a.symbol.localeCompare(b.symbol)));
}
