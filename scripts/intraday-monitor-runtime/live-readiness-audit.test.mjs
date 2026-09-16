import { describe, expect, it, vi } from 'vitest';
import { createPassiveTickSummary, runLiveReadinessAudit } from './live-readiness-audit.mjs';

describe('盤中純接收 readiness audit', () => {
    it('simulation 未確認時不開串流也不查其他介面', async () => {
        const request = vi.fn(async () => Response.json({ simulation: false }));
        await expect(runLiveReadinessAudit({ fetchImpl: request })).rejects.toThrow('simulation_not_confirmed');
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('跨 chunk 解析且只保留 STK 計數，不保存未知欄位或混入的事件', () => {
        const summary = createPassiveTickSummary();
        const event = `event: tick_stk\ndata: ${JSON.stringify({ code: '2330', date: '2026-09-07', time: '09:05:02',
            total_volume: 20, simtrade: false, intraday_odd: false, secret: 'must_not_survive' })}\n\n`;
        summary.push(event.slice(0, 70));
        summary.push(event.slice(70));
        summary.push('event: order_event\ndata: {"secret":"must_not_survive"}\n\n');
        summary.push('event: tick_stk\ndata: {"code":"2330"}\n\n');
        expect(summary.result()).toMatchObject({ tickEvents: 2, structurallyValidRegularTicks: 1,
            rejectedTicks: 1, observedSymbolCount: 1, provesContinuity: false, provesPhysicalOwnership: false });
        expect(JSON.stringify(summary.result())).not.toContain('must_not_survive');
    });

    it('限制未結束的 frame，避免串流無界累積', () => {
        expect(() => createPassiveTickSummary().push('x'.repeat(128 * 1024 + 1))).toThrow('stream_frame_limit');
    });

    it('所有 HTTP 操作都是固定本機 GET，健康與零 SSE 不被推論為 ready', async () => {
        const request = vi.fn(async (url, init) => {
            expect(init.method).toBe('GET');
            expect(new URL(url).hostname).toBe('127.0.0.1');
            if (url.endsWith('/api/v1/info')) return Response.json({ simulation: true, version: '1.7.1', account: 'private' });
            if (url.endsWith('/openapi.json')) return Response.json({ paths: { '/api/v1/stream/data/contract_event': {} } });
            if (url.endsWith('/stream/status')) return Response.json({ active_connections: 0 });
            if (url.endsWith('/tick_stk')) return new Response(': heartbeat\n\n', { headers: { 'content-type': 'text/event-stream' } });
            if (url.endsWith('/diagnostics')) return Response.json({ evidenceRevision: 0, baseline: { complete: false, itemCount: 0 } });
            return Response.json({ state: 'feature_off', generation: 'local_g1', configRevision: 0,
                capacity: { configured: 25, eligible: 23, pilotCohort: 20, dataActive: 0, active: 0,
                    waitingGate: 20, waitingPilotLimit: 3, degraded: 2, confirmedPhysicalUsage: null },
                lease: { activeLeaseCount: 0 } });
        });
        const result = await runLiveReadinessAudit({ fetchImpl: request });
        expect(result.assessment).toMatchObject({ pilotStarted: false, gate0ApprovalIssued: false, fullTradingDayRecorded: false });
        expect(result.assessment.reasons).toContain('physical_usage_unknown');
        expect(result.assessment.reasons).toContain('transport_not_connected');
        expect(result.assessment.reasons).toContain('passive_capture_incomplete');
        expect(result.monitorAfter).toMatchObject({ configured: 25, eligible: 23, pilotCohort: 20,
            dataActive: 0, waitingGate: 20, waitingPilotLimit: 3, degraded: 2 });
        expect(result.passiveCapture.tickEvents).toBe(0);
        expect(JSON.stringify(result)).not.toContain('private');
        expect(request.mock.calls).toHaveLength(10);
    });
});
