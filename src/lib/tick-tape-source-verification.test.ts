import { describe, expect, it } from 'vitest';
import type { HistoryTicks } from './types/tick';
import { mergeTapeInputs } from './tick-tape-session';
import { inspectTapeContinuity, verifyTickTapeSource } from './tick-tape-source-verification';

const contract = { code: '2330', exchange: 'TSE', security_type: 'STK', region: 'TW', target_code: null } as const;
const date = '2026-09-16';
function ticks(rows: Array<[string, number, number, number?]>): HistoryTicks {
    return {
        datetime: rows.map(row => `${date}T${row[0]}`),
        close: rows.map(row => row[1]), volume: rows.map(row => row[2]), tick_type: rows.map(row => row[3] ?? 1),
        bid_price: rows.map(() => 99), bid_volume: rows.map(() => 1), ask_price: rows.map(() => 101), ask_volume: rows.map(() => 1),
    };
}

describe('成交明細來源完整性', () => {
    it('Snapshot 只核對較早 AllDay 時，較新 RangeTime 尾端仍須 live 核對', () => {
        const allDay = ticks([['09:00:01.000000', 100, 10]]);
        const range = ticks([['09:00:01.000000', 100, 10], ['09:00:02.000000', 100, 5]]);
        const result = verifyTickTapeSource({ contract, date, allDay, range, snapshotTotalVolume: 10, generation: 1 });
        expect(result.evidence.state).toBe('partial');
        expect(result.evidence.gaps).toEqual(['snapshot_behind_range_tail']);
        expect(result.evidence.regularVolume).toBe(15);
    });
    it('AllDay 空白但 RangeTime 有成交時不能用零長共同前綴核實', () => {
        const result = verifyTickTapeSource({ contract, date, allDay: ticks([]), range: ticks([['09:00:01.000000', 100, 10]]), snapshotTotalVolume: 10, generation: 1 });
        expect(result.evidence.state).toBe('partial');
        expect(result.evidence.gaps).toContain('all_day_range_mismatch');
    });
    it('AllDay、RangeTime 逐筆一致且 Snapshot 總量守恆時核實完整，保留延後收盤並排除 14:00 固定交易', () => {
        const allDay = ticks([
            ['09:00:00.000000', 100, 10], ['10:00:00.000000', 100, 10],
            ['13:33:00.000000', 101, 5], ['14:00:00.000000', 101, 1],
        ]);
        const range = ticks([
            ['09:00:00.000000', 100, 10], ['10:00:00.000000', 100, 10], ['13:33:00.000000', 101, 5],
        ]);
        const verified = verifyTickTapeSource({ contract, date, allDay, range, snapshotTotalVolume: 26, generation: 1 });
        expect(verified.evidence).toMatchObject({ state: 'verified', regularCount: 3, postSessionCount: 1, regularVolume: 25, postSessionVolume: 1 });
        expect(verified.inputs.map(input => input.time)).toEqual(['09:00:00.000000', '10:00:00.000000', '13:33:00.000000']);
        expect(verified.inputs.map(input => input.sourceCumulativeVolume)).toEqual([10, 20, 25]);
        expect(inspectTapeContinuity(verified.inputs)).toMatchObject({ continuous: true, cumulative: 25 });
    });

    it('相同時間價格張數的真實成交以累計量保留，live 重播只排除同一來源序號', () => {
        const allDay = ticks([['10:00:00.000000', 100, 10], ['10:00:00.000000', 100, 10]]);
        const verified = verifyTickTapeSource({ contract, date, allDay, range: allDay, snapshotTotalVolume: 20, generation: 1 });
        const replay = { ...verified.inputs[1]!, source: 'live' as const };
        const next = { ...replay, sourceSequence: `${date}|regular|30`, sourceCumulativeVolume: 30 };
        expect(mergeTapeInputs(verified.inputs, [replay, next])).toHaveLength(3);
        expect(inspectTapeContinuity(mergeTapeInputs(verified.inputs, [next]))).toMatchObject({ continuous: true, cumulative: 30 });
    });

    it('歷史來源亂序時穩定按成交時間核對與重播', () => {
        const unsorted = ticks([['10:00:02.000000', 102, 2], ['10:00:01.000000', 101, 1]]);
        const ordered = ticks([['10:00:01.000000', 101, 1], ['10:00:02.000000', 102, 2]]);
        const result = verifyTickTapeSource({ contract, date, allDay: unsorted, range: ordered, snapshotTotalVolume: 3, generation: 1 });
        expect(result.evidence.state).toBe('verified');
        expect(result.inputs.map(input => [input.time, input.sourceCumulativeVolume])).toEqual([
            ['10:00:01.000000', 1], ['10:00:02.000000', 3],
        ]);
    });

    it('盤中後查的 RangeTime 只多較新尾端時，以完整共同前綴核實且不誤判來源不一致', () => {
        const allDay = ticks([['09:00:01.000000', 100, 10], ['09:00:02.000000', 100, 10]]);
        const range = ticks([['09:00:01.000000', 100, 10], ['09:00:02.000000', 100, 10], ['09:00:03.000000', 101, 5]]);
        const result = verifyTickTapeSource({ contract, date, allDay, range, snapshotTotalVolume: 25, generation: 1 });
        expect(result.evidence).toMatchObject({ state: 'verified', commonPrefixCount: 2, regularAuthority: 'range_tail', regularCount: 3 });
        expect(result.inputs.map(input => input.sourceCumulativeVolume)).toEqual([10, 20, 25]);
    });

    it('RangeTime 改寫共同前綴或缺少後段時仍保持來源不一致', () => {
        const allDay = ticks([['09:00:01.000000', 100, 10], ['09:00:02.000000', 100, 10]]);
        const rewritten = ticks([['09:00:01.000000', 100, 10], ['09:00:02.000000', 101, 10], ['09:00:03.000000', 101, 5]]);
        expect(verifyTickTapeSource({ contract, date, allDay, range: rewritten, snapshotTotalVolume: 25, generation: 1 }).evidence.gaps).toContain('all_day_range_mismatch');
        expect(verifyTickTapeSource({ contract, date, allDay, range: ticks([['09:00:01.000000', 100, 10]]), snapshotTotalVolume: 20, generation: 1 }).evidence.gaps).toContain('all_day_range_mismatch');
    });

    it('截斷、Snapshot 超前及累計缺口都保持部分資料', () => {
        const allDay = ticks([['09:00:01.000000', 100, 10], ['09:00:02.000000', 100, 10]]);
        const truncated = ticks([['09:00:01.000000', 100, 10]]);
        const result = verifyTickTapeSource({ contract, date, allDay, range: truncated, snapshotTotalVolume: 30, generation: 1 });
        expect(result.evidence.state).toBe('partial');
        expect(result.evidence.gaps).toEqual(['all_day_range_mismatch', 'snapshot_ahead_of_history']);
        const sequenced = verifyTickTapeSource({ contract, date, allDay, range: allDay, snapshotTotalVolume: 30, generation: 1 });
        const gap = { ...sequenced.inputs[1]!, time: '09:00:03', source: 'live' as const, sourceSequence: `${date}|regular|40`, sourceCumulativeVolume: 40 };
        expect(inspectTapeContinuity(mergeTapeInputs(sequenced.inputs, [gap]))).toMatchObject({ continuous: false, reason: 'source_cumulative_volume_gap' });
    });

    it('非法價格、張數、時間或方向欄位不能被標記已核實', () => {
        const invalid = ticks([['09:00:01.000000', 0, 10]]);
        const result = verifyTickTapeSource({ contract, date, allDay: invalid, range: invalid, snapshotTotalVolume: 10, generation: 1 });
        expect(result.evidence).toMatchObject({ state: 'partial', gaps: ['invalid_history_row'] });
        expect(result.inputs).toHaveLength(0);
    });

    it('只有雙歷史來源空白且 Snapshot 為零才能確認無成交', () => {
        const empty = ticks([]);
        expect(verifyTickTapeSource({ contract, date, allDay: empty, range: empty, snapshotTotalVolume: 0, generation: 1 }).evidence.state).toBe('confirmed_empty');
        expect(verifyTickTapeSource({ contract, date, allDay: empty, range: empty, snapshotTotalVolume: null, generation: 1 }).evidence.state).toBe('partial');
        expect(verifyTickTapeSource({ contract, date, allDay: empty, range: empty, snapshotTotalVolume: 10, generation: 1 }).evidence.state).toBe('partial');
    });
});
