/** 僅規劃已驗證官方交易日；來源 empty／HTML／網路錯誤不能更改 calendar。 */
import { BOLLINGER_HISTORY_CAPABILITY, bollingerRequiredHistory, validateBollingerSqueeze,
    type BollingerSqueezeCriteria } from './stock-screener-v8.ts';

export const BOLLINGER_DEFAULT_HISTORY_DAYS = 160;
export interface VerifiedBollingerCalendar {
    status: 'verified';
    commonSessions: string[];
    validThrough: string;
    authorityHash: string;
}
const date = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
    && Number.isFinite(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
export function planBollingerHistory(calendar: VerifiedBollingerCalendar, through: string,
    criteria: BollingerSqueezeCriteria, profileRevision: string, now = new Date()) {
    if (!validateBollingerSqueeze(criteria) || !profileRevision || !date(through)
        || calendar?.status !== 'verified' || !/^[a-f0-9]{64}$/.test(calendar.authorityHash)
        || !Array.isArray(calendar.commonSessions) || calendar.commonSessions.some((d, i) => !date(d) || i > 0 && d <= calendar.commonSessions[i - 1]!)
        || !Number.isFinite(Date.parse(calendar.validThrough)) || Date.parse(calendar.validThrough) < now.getTime()
        || !calendar.commonSessions.includes(through)) throw new Error('calendar_authority_pending');
    const requiredDays = bollingerRequiredHistory(criteria);
    const plannedDays = Math.max(BOLLINGER_DEFAULT_HISTORY_DAYS, requiredDays);
    const sessions = calendar.commonSessions.filter(d => d <= through).slice(-plannedDays);
    return { capability: BOLLINGER_HISTORY_CAPABILITY, profileRevision, through, requiredDays, plannedDays,
        availableDays: sessions.length, sessions, authorityHash: calendar.authorityHash,
        state: sessions.length === plannedDays ? 'planned' as const : 'history_pending' as const,
        // 單個 target 是 market/date 批次；先準備最近日期，不產生逐檔 broker 請求。
        targets: [...sessions].reverse().flatMap(sessionDate => (['TWSE', 'TPEx'] as const).map(market => ({
            market, sessionDate, key: `${BOLLINGER_HISTORY_CAPABILITY}|${market}|${sessionDate}` }))) };
}

export function bollingerRetentionUnion(...dependencies: readonly (readonly string[])[]): string[] {
    if (dependencies.some(ds => !Array.isArray(ds) || ds.some(d => !date(d)))) throw new Error('invalid_bollinger_retention');
    return [...new Set(dependencies.flat())].sort();
}

/** 跨能力保留：準備中計畫與已發布快照的資料不可被舊 130 日 prune 刪除。 */
export async function readBollingerRetention(db: {
    prepare(sql: string): { all(): Promise<{ results?: Array<Record<string, unknown>> }> };
}): Promise<string[]> {
    const plans = (await db.prepare("SELECT checkpoint FROM screener_runs WHERE scope='screener-bollinger-history-plan' AND status IN ('pending','running','complete')").all()).results ?? [];
    const snapshots = (await db.prepare("SELECT metadata FROM screener_snapshots WHERE schema_version=8 AND status='published'").all()).results ?? [];
    // 舊資料庫尚未安裝新 schema 時維持舊行為；所有保留報告（含舊 profile）都保護其窗口。
    const installed = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='screener_bollinger_publications'").all()).results ?? [];
    if (installed.length) snapshots.push(...(await db.prepare("SELECT metadata FROM screener_bollinger_publications WHERE status='published'").all()).results ?? []);
    const dependencies: string[][] = [];
    for (const row of plans) {
        const plan = JSON.parse(String(row.checkpoint));
        if (plan.capability !== BOLLINGER_HISTORY_CAPABILITY || !Array.isArray(plan.sessions) || !plan.sessions.length) throw new Error('invalid_bollinger_retention');
        dependencies.push(plan.sessions);
    }
    for (const row of snapshots) {
        const metadata = JSON.parse(String(row.metadata));
        if (metadata.capability !== BOLLINGER_HISTORY_CAPABILITY || !Array.isArray(metadata.historySessions) || !metadata.historySessions.length) throw new Error('invalid_bollinger_retention');
        dependencies.push(metadata.historySessions);
    }
    return bollingerRetentionUnion(...dependencies);
}
