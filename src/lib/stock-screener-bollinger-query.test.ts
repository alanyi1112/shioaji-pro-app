import { describe, expect, it } from 'vitest';
import { buildBollingerFrozenFeatures, DEFAULT_BOLLINGER_SQUEEZE, type BollingerOutcome } from './stock-screener-v8.ts';
import { queryBollingerSnapshot, validateBollingerFrozenFeatures, validateAndSealBollingerFrozenFeatures, bollingerSortMetric,
    type BollingerQuerySnapshot, type BollingerReadQuery } from './stock-screener-bollinger-query.ts';

// 隔離日期及價量，不是官方來源／自動發布證據。
const sessions = Array.from({ length: 160 }, (_, i) => new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10));
const bars = sessions.map((sessionDate, i) => {
    const p = 100 + i * .04 + Math.sin(i * .7) * (i < 120 ? 3 : 3 * Math.exp(-(i - 120) / 12));
    return { sessionDate, open: p.toFixed(6), high: (p + 1).toFixed(6), low: (p - 1).toFixed(6),
        close: p.toFixed(6), volumeShares: i >= 145 ? '600000' : '1000000', turnoverNtd: '100000000' };
});
const query = (): BollingerReadQuery => ({ criteria: { ...structuredClone(DEFAULT_BOLLINGER_SQUEEZE), enabled: true },
    sort: { key: 'code', direction: 'asc' }, state: 'all', limit: 1 });
async function snapshot(): Promise<BollingerQuerySnapshot> {
    const features = await buildBollingerFrozenFeatures(bars, sessions, ['a'.repeat(64)]);
    const missing = await buildBollingerFrozenFeatures([], sessions);
    return { id: '12345678-1234-1234-1234-123456789012', universeRevision: 'fixture-1', effectiveSessionDate: sessions.at(-1)!, historySessions: sessions,
        rows: [{ symbol: '2449.TW', code: '2449', name: 'fixture', market: 'TWSE', ordinary: true, features },
            { symbol: '6488.TWO', code: '6488', name: 'fixture', market: 'TPEx', ordinary: true, features },
            { symbol: '1111.TW', code: '1111', name: 'fixture-gap', market: 'TWSE', ordinary: true, features: missing }] };
}
describe('v8 frozen唯讀查詢', () => {
    it('完整驗證後只重用深度不可變的同一物件，clone及新底稿仍檢查hash', async () => {
        const f = (await snapshot()).rows[0]!.features;
        Object.freeze(f); // 只有外層已凍結，不能把可改動的子物件當成已封存。
        expect(await validateAndSealBollingerFrozenFeatures(f)).toBe(true);
        expect(Object.isFrozen(f)).toBe(true);
        expect(Object.isFrozen(f.points[159]!.boll)).toBe(true);
        expect(Object.isFrozen(f.volume.sums)).toBe(true);
        expect(() => { f.points[159]!.close = 1000; }).toThrow();
        expect(() => { f.volume.sums[160] = '0'; }).toThrow();
        expect(await validateBollingerFrozenFeatures(f)).toBe(true);
        const clone = structuredClone(f); clone.points[159]!.close = 1000;
        expect(await validateBollingerFrozenFeatures(clone)).toBe(false);
        expect(await validateAndSealBollingerFrozenFeatures(clone)).toBe(false);
        expect(Object.isFrozen(clone)).toBe(false);
    });
    it('穩定排序、分頁、母體守恆；不修改snapshot或設定', async () => {
        const s = await snapshot(), q = query(), before = JSON.stringify({ s, q });
        const one = await queryBollingerSnapshot(s, q);
        expect(one.state).toBe('ready'); expect(one.rows[0]?.code).toBe('1111');
        expect(one.counts?.total.total).toBe(3); expect(one.counts?.markets.TWSE.total).toBe(2);
        expect(one.nextCursor).toBeTruthy();
        const two = await queryBollingerSnapshot(s, { ...q, cursor: one.nextCursor! });
        const three = await queryBollingerSnapshot(s, { ...q, cursor: two.nextCursor! });
        expect([two.rows[0]?.code, three.rows[0]?.code]).toEqual(['2449', '6488']);
        expect(three.nextCursor).toBeNull(); expect(JSON.stringify({ s, q })).toBe(before);
    });
    it.each(['bbw', 'b', 'momentum', 'percentilePosition', 'breakoutVolumeRatio'] as const)('%s的unknown在asc及desc都置末', async key => {
        const s = await snapshot();
        for (const direction of ['asc', 'desc'] as const) {
            const result = await queryBollingerSnapshot(s, { ...query(), limit: 100, sort: { key, direction } });
            expect(result.rows.at(-1)?.code).toBe('1111');
        }
    });
    it('fingerprint綁定快照、設定、stage集合、排序、limit及狀態', async () => {
        const s = await snapshot(), q = query(), first = await queryBollingerSnapshot(s, q);
        const changes: BollingerReadQuery[] = [
            { ...q, criteria: { ...q.criteria, percentile: 21 } },
            { ...q, criteria: { ...q.criteria, stages: ['breakout'] } },
            { ...q, criteria: { ...q.criteria, breakoutVolumeRatio: '1.5' } },
            { ...q, sort: { key: 'b', direction: 'desc' } }, { ...q, limit: 2 }, { ...q, state: 'matched' },
        ];
        for (const changed of changes) await expect(queryBollingerSnapshot(s, { ...changed, cursor: first.nextCursor! })).rejects.toThrow('invalid_bollinger_cursor');
        await expect(queryBollingerSnapshot({ ...s, id: crypto.randomUUID() }, { ...q, cursor: first.nextCursor! })).rejects.toThrow('invalid_bollinger_cursor');
        const same = await queryBollingerSnapshot(s, { ...q, criteria: { ...q.criteria, stages: [...q.criteria.stages].reverse() } });
        expect(same.fingerprint).toBe(first.fingerprint);
    });
    it('有界參數拒絕非法cursor，不把HTML／跨版本／被改動底稿當v8', async () => {
        const s = await snapshot();
        for (const cursor of ['', '!', 'a'.repeat(513), btoa('{}')])
            await expect(queryBollingerSnapshot(s, { ...query(), cursor })).rejects.toThrow('invalid_bollinger_cursor');
        await expect(queryBollingerSnapshot(s, { ...query(), limit: 101 })).rejects.toThrow('invalid_bollinger_query');
        const f = structuredClone(s.rows[0]!.features); f.points[159]!.close = 1000;
        expect(await validateBollingerFrozenFeatures(f)).toBe(false);
        await expect(queryBollingerSnapshot({ ...s, rows: [{ ...s.rows[0]!, features: f }] }, query())).rejects.toThrow('invalid_bollinger_snapshot');
        const invalid = structuredClone(s.rows[0]!.features); invalid.points.pop();
        expect(await validateBollingerFrozenFeatures(invalid)).toBe(false);
        expect(await validateBollingerFrozenFeatures({ ...invalid, version: 7 } as never)).toBe(false);
    });
    it('放大參數回history_pending，不將160日冒充所需290日', async () => {
        const result = await queryBollingerSnapshot(await snapshot(), { ...query(), criteria: { ...query().criteria, lookbackDays: 250, setupDays: 20 } });
        expect(result.state).toBe('history_pending'); expect(result.requiredDays).toBe(290); expect(result.availableDays).toBe(160);
        expect(result.rows).toEqual([]);
    });
    it('突破量倍數排序以exact rational保留超過safe integer的差異', () => {
        const make = (n: string) => ({ breakoutChecks: { expansion: { actual: { currentShares: n, baselineSumShares: '10000000000000000000', baselineDays: 20 } } } }) as unknown as BollingerOutcome;
        expect(bollingerSortMetric(make('9007199254740993'), 'breakoutVolumeRatio')).toEqual({ numerator: 180143985094819860n, denominator: 10000000000000000000n });
    });
});
