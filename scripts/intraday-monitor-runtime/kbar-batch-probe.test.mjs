import { describe, expect, it } from 'vitest';
import { createKbarEventSummary } from './kbar-batch-probe.mjs';

describe('KBar 多商品探針摘要', () => {
    it('只保存逐商品完成分鐘摘要，不保存原始 payload', () => {
        const summary = createKbarEventSummary(['2330', '2454']);
        summary.push(': heartbeat\n\nevent: kbar\ndata: {"code":"2330","date":"2026-09-07","time":"09:30:00","volume":120}\n\n');
        summary.push('event: kbar\ndata: {"code":"2454","date":"2026-09-07","time":"09:30:00","volume":30}\n\n');
        expect(summary.result()).toMatchObject({
            kbarEvents: 2,
            rejectedEvents: 0,
            unexpectedSymbols: 0,
            payloadShapes: [
                'code:string,date:string,time:string,volume:number',
            ],
            rawPayloadSaved: false,
            symbols: {
                2330: { validCompletedMinutes: 1, accumulatedVolume: 120 },
                2454: { validCompletedMinutes: 1, accumulatedVolume: 30 },
            },
        });
    });

    it('拒絕 malformed 與 cohort 外事件', () => {
        const summary = createKbarEventSummary(['2330']);
        summary.push('event: kbar\ndata: {"code":"2330","date":"2026-09-07","time":"bad","volume":1}\n\n');
        summary.push('event: kbar\ndata: {"code":"2454","date":"2026-09-07","time":"09:30:00","volume":1}\n\n');
        expect(summary.result()).toMatchObject({ kbarEvents: 2, rejectedEvents: 1, unexpectedSymbols: 1 });
    });

    it('對過大未完成 frame fail closed', () => {
        const summary = createKbarEventSummary(['2330']);
        expect(() => summary.push('x'.repeat(128 * 1024 + 1))).toThrow('stream_frame_limit');
    });
});
