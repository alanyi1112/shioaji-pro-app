import { afterEach, expect, it, vi } from 'vitest';
import { readIntradayMonitorResultsSnapshot } from './intraday-monitor-api';
afterEach(() => vi.unstubAllGlobals());
const reply = (items: unknown[], nextCursor: string | null, revision = 245, generation = 'fixture-generation') => ({
    ok: true, json: async () => ({ items, nextCursor, cursor: nextCursor ?? 'final-cursor',
        generation, repositoryRevision: revision, authority: 'historical' }),
});
it('讀完245筆三頁，保留終點cursor且只有本機唯讀GET', async () => {
    let index = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        const start = index++ * 100, end = Math.min(245, start + 100);
        return reply(Array.from({ length: end - start }, (_, i) => ({ eventId: `event-${start + i}`,
            notificationAuthority: false })), end < 245 ? `page-${index}` : null);
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await readIntradayMonitorResultsSnapshot('2026-10-15');
    expect(result.items).toHaveLength(245);
    expect(result.cursor).toBe('final-cursor');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('cursor=page-1');
    expect(fetchMock.mock.calls.every(call => String(call[0]).startsWith('/api/intraday-monitor/v1/results?'))).toBe(true);
});
it.each(['revision', 'generation'])('分頁期間%s改變，不混合快照', async key => {
    let index = 0;
    vi.stubGlobal('fetch', vi.fn(async () => index++ === 0 ? reply([{ eventId: 'one' }], 'next')
        : reply([{ eventId: 'two' }], null, key === 'revision' ? 246 : 245,
            key === 'generation' ? 'other-generation' : 'fixture-generation')));
    await expect(readIntradayMonitorResultsSnapshot('2026-10-15')).rejects.toThrow('snapshot_changed');
});
it('重複cursor有界拒絕，不無限重抓第一頁', async () => {
    const fetchMock = vi.fn(async () => reply([{ eventId: 'one' }], 'same'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(readIntradayMonitorResultsSnapshot('2026-10-15')).rejects.toThrow('cursor_not_advancing');
    expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('連續不同cursor也至多32頁，不把有界截斷假稱完整', async () => {
    let index = 0;
    const fetchMock = vi.fn(async () => reply([{ eventId: `row-${index}` }], `cursor-${++index}`));
    vi.stubGlobal('fetch', fetchMock);
    await expect(readIntradayMonitorResultsSnapshot('2026-10-15')).rejects.toThrow('snapshot_page_limit');
    expect(fetchMock).toHaveBeenCalledTimes(32);
});
