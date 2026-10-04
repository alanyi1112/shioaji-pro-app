import { expect, it } from 'vitest';
import { DEFAULT_BOLLINGER_SQUEEZE } from './stock-screener-v8.ts';
import { bollingerRetentionUnion, planBollingerHistory, readBollingerRetention } from './stock-screener-bollinger-history.ts';

// 測試的日期 grid 是隔離輸入，不能視為已核實官方日曆。
const days = Array.from({ length: 330 }, (_, i) => new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10));
const calendar = { status: 'verified' as const, commonSessions: days, authorityHash: 'a'.repeat(64), validThrough: '2027-01-01T00:00:00Z' };
const now = new Date('2026-01-01T00:00:00Z');
it('預設 160 日，放大參數有界擴窗，targets 最新日優先且逐市場批次', () => {
    const p = planBollingerHistory(calendar, days.at(-1)!, DEFAULT_BOLLINGER_SQUEEZE, 'r1', now);
    expect(p.requiredDays).toBe(145); expect(p.sessions).toHaveLength(160); expect(p.targets).toHaveLength(320);
    expect(p.targets[0]!.sessionDate).toBe(days.at(-1));
    const longer = planBollingerHistory(calendar, days.at(-1)!, { ...DEFAULT_BOLLINGER_SQUEEZE, lookbackDays: 250, setupDays: 20 }, 'r2', now);
    expect(longer.plannedDays).toBe(290); expect(longer.sessions).toHaveLength(290);
});
it('少於需求不縮窗假稱 ready，source receipts 不參與刪交易日', () => {
    const p = planBollingerHistory({ ...calendar, commonSessions: days.slice(-130) }, days.at(-1)!, DEFAULT_BOLLINGER_SQUEEZE, 'r1', now);
    expect(p.state).toBe('history_pending'); expect(p.plannedDays).toBe(160); expect(p.availableDays).toBe(130);
});
it('拒絕過期／不明 authority、亂序及不存在的交易日', () => {
    for (const cal of [{ ...calendar, status: 'unknown' }, { ...calendar, validThrough: '2025-01-01' },
        { ...calendar, authorityHash: '' }, { ...calendar, commonSessions: [...days].reverse() }]) {
        expect(() => planBollingerHistory(cal as never, days.at(-1)!, DEFAULT_BOLLINGER_SQUEEZE, 'r1', now)).toThrow('calendar_authority_pending');
    }
    expect(() => planBollingerHistory(calendar, '2024-01-01', DEFAULT_BOLLINGER_SQUEEZE, 'r1', now)).toThrow('calendar_authority_pending');
});
it('保留聯集包含能力、準備計畫與所有保留快照，非法日期 fail closed', async () => {
    const db = { prepare: (sql: string) => ({ all: async () => ({ results: sql.includes('screener_runs')
        ? [{ checkpoint: JSON.stringify({ capability: 'bollinger-history-v1', sessions: days.slice(-160) }) }]
        : [{ metadata: JSON.stringify({ capability: 'bollinger-history-v1', historySessions: days.slice(0, 3) }) }] }) }) };
    const keep = await readBollingerRetention(db);
    expect(keep).toHaveLength(163);
    expect(bollingerRetentionUnion(days.slice(-130), keep)).toHaveLength(163);
    expect(() => bollingerRetentionUnion(['2026-02-30'])).toThrow('invalid_bollinger_retention');
    const invalid = { prepare: () => ({ all: async () => ({ results: [{ checkpoint: '{invalid' }] }) }) };
    await expect(readBollingerRetention(invalid)).rejects.toThrow();
});
