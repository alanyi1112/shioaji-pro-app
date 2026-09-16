import { describe, expect, it } from 'vitest';

import { createDirect160GapBootstrapWorker, validateDirect160GapBootstrap }
    from './direct-160-gap-bootstrap.mjs';

const contract = { securityType: 'STK', region: 'TW', exchange: 'TSE', code: '2330',
    targetCode: null, canonicalSymbol: '2330.TW' };
function body(minutes = ['09:01', '09:02'], volumes = [10, 20]) {
    return { datetime: minutes.map((minute) => `2026-09-16T${minute}:00`),
        Open: minutes.map(() => 100), High: minutes.map(() => 101),
        Low: minutes.map(() => 99), Close: minutes.map(() => 100),
        Volume: volumes, Amount: minutes.map(() => 1_000_000) };
}
function input(overrides = {}) {
    return { contract, tradeDate: '2026-09-16', endMinute: '09:02',
        first: body(), second: body(), fetchedAt: '2026-09-16T09:03:00+08:00',
        refetchedAt: '2026-09-16T09:03:01+08:00', restGeneration: 'rest_generation_00000001',
        liveGeneration: 'simulation:live_generation_0001', sourceVersion: 'shioaji-http-1.7.1',
        liveOverlap: [{ minuteKey: '09:02', volumeCommonLot: 20 }], ...overrides };
}

describe('direct 160 有界盤中 KBar gap bootstrap', () => {
    it('雙抓 hash、完整分鐘與 SSE overlap 相同才建立 common_lot receipt', () => {
        expect(validateDirect160GapBootstrap(input())).toMatchObject({ ok: true, receipt: {
            requestedMinuteStart: '09:01', requestedMinuteEnd: '09:02', expectedMinuteCount: 2,
            actualMinuteCount: 2, stableRefetch: true, liveDelivered: false,
            rows: [{ minuteKey: '09:01', volumeCommonLot: 10, cumulativeVolume: 10 },
                { minuteKey: '09:02', volumeCommonLot: 20, cumulativeVolume: 30 }],
            liveOverlap: { matched: true, comparedMinutes: ['09:02'] },
            notificationAuthority: false,
        } });
    });
    it('首筆 live 延到下一分鐘時以該分鐘核對 overlap，但 receipt 只保存前段缺口', () => {
        const value = validateDirect160GapBootstrap(input({
            overlapMinute: '09:03',
            first: body(['09:01', '09:02', '09:03'], [10, 20, 30]),
            second: body(['09:01', '09:02', '09:03'], [10, 20, 30]),
            liveOverlap: [{ minuteKey: '09:03', volumeCommonLot: 30 }],
        }));
        expect(value).toMatchObject({ ok: true, receipt: {
            requestedMinuteEnd: '09:02', validationMinuteEnd: '09:03',
            expectedMinuteCount: 2, actualMinuteCount: 2,
            rows: [{ minuteKey: '09:01' }, { minuteKey: '09:02' }],
            liveOverlap: { matched: true, comparedMinutes: ['09:03'] },
        } });
        expect(validateDirect160GapBootstrap(input({
            overlapMinute: '09:04',
            first: body(['09:01', '09:02', '09:03', '09:04'], [10, 20, 30, 40]),
            second: body(['09:01', '09:02', '09:03', '09:04'], [10, 20, 30, 40]),
            liveOverlap: [{ minuteKey: '09:04', volumeCommonLot: 40 }],
        }))).toMatchObject({ ok: false, reasons: expect.arrayContaining(['overlap_minute_invalid']) });
    });
    it('欄位不等長、缺分鐘、重複 row 與 refetch 不穩定皆 fail closed', () => {
        expect(validateDirect160GapBootstrap(input({ first: { ...body(), Amount: [1] } })).reasons)
            .toContain('column_length_mismatch');
        expect(validateDirect160GapBootstrap(input({ first: body(['09:01'], [10]) })).reasons)
            .toContain('minute_coverage_incomplete');
        expect(validateDirect160GapBootstrap(input({ first: body(['09:01', '09:01'], [10, 20]) })).reasons)
            .toContain('duplicate_or_non_monotonic_minute');
        expect(validateDirect160GapBootstrap(input({ second: body(['09:01', '09:02'], [10, 21]) })).reasons)
            .toContain('refetch_payload_unstable');
    });
    it('REST／SSE 重疊量衝突、未完成分鐘及超出一般盤範圍會拒絕', () => {
        expect(validateDirect160GapBootstrap(input({ liveOverlap: [{ minuteKey: '09:02',
            volumeCommonLot: 99 }] })).reasons).toContain('live_overlap_conflict');
        expect(validateDirect160GapBootstrap(input({ endMinute: '09:03' })).reasons)
            .toContain('minute_coverage_incomplete');
        expect(validateDirect160GapBootstrap(input({ endMinute: '13:31' })).reasons)
            .toContain('range_invalid');
    });

    it('worker 在同一 simulation generation 對每檔雙抓並回傳有界 receipt', async () => {
        const calls = [];
        const fetchImpl = async (url, init = {}) => {
            calls.push({ url, body: init.body ?? null });
            if (url.endsWith('/info')) return new Response(JSON.stringify({ simulation: true,
                version: '1.7.1' }), { status: 200 });
            return new Response(JSON.stringify(body()), { status: 200 });
        };
        const worker = createDirect160GapBootstrapWorker({ fetchImpl, concurrency: 2,
            now: () => '2026-09-16T09:03:00+08:00' });
        const result = await worker.run({ contracts: [contract], tradeDate: '2026-09-16',
            endMinute: '09:02', liveGeneration: 'simulation:live_generation_0001' });
        expect(result).toMatchObject({ requested: 1, completed: 1, degraded: 0,
            notificationAuthority: false });
        expect(calls.filter((call) => call.url.endsWith('/data/kbars'))).toHaveLength(2);
        expect(result.receipts[0]).toMatchObject({ restGeneration: 'rest:simulation:live_generation_0001',
            liveGeneration: 'simulation:live_generation_0001' });
    });
});
