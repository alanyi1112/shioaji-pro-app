import { describe, expect, it } from 'vitest';
import { emptyIntradayMonitorResultMessage, normalizeIntradayMonitorStatus, overallMonitorLabel, sortIntradayMonitorResults } from './intraday-monitor-view-model';
import type { IntradayMonitorStatusView, IntradayMonitorTriggerView } from './intraday-monitor-api';

const status = (patch: Partial<IntradayMonitorStatusView> = {}): IntradayMonitorStatusView => ({
    state: 'active', reason: 'none', generation: 'generation_identity_1234', configRevision: 1,
    lease: { activeLeaseCount: 1, sessionState: 'active', acceptingEvents: true },
    capacity: { configured: 2, eligible: 2, pilotCohort: 2, dataActive: 2, active: 2, waiting: 0, waitingGate: 0, waitingPilotLimit: 0, waitingCapacity: 0, waitingBaseline: 0, degraded: 0, confirmedPhysicalUsage: 2, confirmedOtherPhysicalUsage: 0, localPhysicalLimit: 160, requiredHeadroom: 40, availableForMonitor: 158, gate0EvidenceCurrent: true, globalOwnershipComplete: true },
    approval: { approvedActiveLimit: 160, stage: 160, decision: 'go', reviewerType: 'codex_delegated',
        reviewedAt: '2026-09-16T14:00:00+08:00', evidenceTradeDate: '2026-09-16', historical: true },
    session: { authorityTradeDate: '2026-09-04', sessionTradeDate: '2026-09-04', phase: 'running',
        current: true, configRevision: 1, savedConfigRevision: 1,
        startedAt: '2026-09-04T08:50:00+08:00', updatedAt: '2026-09-04T10:11:00+08:00',
        staleReason: null, controlPlaneRequested: true, controlPlaneAccepted: true,
        firstKbarAt: '2026-09-04T09:01:01+08:00' },
    baselineSummary: { complete: 2, missing: 0, stale: 0, unknown: 0, tradeDates: ['2026-09-03'] },
    freshness: { evidenceAt: '2026-09-04T10:11:00+08:00', ageMs: 0, budgetMs: 120000, fresh: true },
    itemStatuses: [], observedAt: '2026-09-04T02:00:00Z', ...patch,
});

const result = (eventId: string, code: string, minuteKey: string, ratio: number): IntradayMonitorTriggerView => ({
    eventId, eventHash: 'a'.repeat(64), kind: 'live', tradeDate: '2026-09-04', baselineTradeDate: '2026-09-03', canonicalSymbol: `${code}.TW`, exchange: 'TSE', minuteKey, configRevision: 1, threshold: '1.5', currentCumulativeVolume: ratio * 100, previousCumulativeVolume: 100, unit: 'common_lot', sourceVersion: 'fixture/1', formulaVersion: 'relative-volume/1', completeness: 'complete', createdAt: `2026-09-04T${minuteKey}:00+08:00`, notificationAuthority: false,
});

describe('盤中監控 view model', () => {
    it('盤後partial保留唯讀收尾分類，不回寫current或通知權限', () => {
        const x = status({ runtimeMode: 'daily', state: 'degraded', reason: 'daily_close_partial',
            session: { ...status().session, current: false, staleReason: 'evidence_stale' },
            freshness: { ...status().freshness, fresh: false },
            dailyExecution: { state: 'partial', completedAt: '2026-09-04T05:34:30Z',
                completeCount: 1, partialCount: 1 } as IntradayMonitorStatusView['dailyExecution'] });
        expect(normalizeIntradayMonitorStatus(x)).toMatchObject({ state: 'degraded',
            reason: 'daily_close_partial', session: { current: false },
            capacity: { active: 0, dataActive: 0, notificationAuthority: false } });
        expect(normalizeIntradayMonitorStatus({ ...x,
            session: { ...x.session, sessionTradeDate: '2026-09-03' } })).toMatchObject({
            state: 'feature_off', session: { current: false } });
        expect(normalizeIntradayMonitorStatus({ ...x, reason: 'premarket_capture_failed' })).toMatchObject({
            state: 'feature_off', session: { current: false } });
        expect(normalizeIntradayMonitorStatus({ ...x,
            session: { ...x.session, staleReason: 'generation_mismatch' } })).toMatchObject({
            state: 'feature_off', reason: 'generation_mismatch' });
    });
    it('只有 lease、status 與 active evidence 同時成立才顯示監控中', () => {
        expect(overallMonitorLabel(status(), false, 'connected')).toBe('監控中');
        expect(overallMonitorLabel(status(), false, 'reconnecting')).toBe('重新連線中');
        expect(overallMonitorLabel(status({ capacity: { ...status().capacity, active: 0, waitingBaseline: 2, waiting: 2 } }), false, 'connected')).toBe('等待基準');
        expect(overallMonitorLabel(status({ state: 'idle', capacity: { ...status().capacity, active: 0, dataActive: 0, waitingPilotLimit: 3, waiting: 3 } }), false, 'connected')).toBe('等待 pilot limit');
        expect(overallMonitorLabel(status({ state: 'degraded' }), false, 'connected')).toBe('部分 degraded');
        expect(overallMonitorLabel(status(), true, 'connected')).toBe('服務離線');
    });

    it('依觸發時間、目前 ratio 或代碼排序並以 event id 穩定決勝', () => {
        const items = [result('event_b', '2454', '10:05', 1.6), result('event_a', '2330', '10:06', 2.1)];
        expect(sortIntradayMonitorResults(items, 'trigger_time').map((item) => item.eventId)).toEqual(['event_b', 'event_a']);
        expect(sortIntradayMonitorResults(items, 'ratio').map((item) => item.eventId)).toEqual(['event_a', 'event_b']);
        expect(sortIntradayMonitorResults(items, 'code').map((item) => item.eventId)).toEqual(['event_a', 'event_b']);
    });

    it('舊 server 缺少 session 欄位時只保留歷史 approval 並清零 today live', () => {
        const legacy = { ...status(), approval: undefined, session: undefined,
            baselineSummary: undefined, freshness: undefined,
            capacity: { ...status().capacity, approvedActiveLimit: 160,
                evaluationStageTarget: 160 as const, evaluationState: 'go' as const,
                dataActive: 160, active: 160, controlPlaneSubscriptionRequested: true } };
        const normalized = normalizeIntradayMonitorStatus(legacy);
        expect(normalized).toMatchObject({ state: 'feature_off', reason: 'current_session_missing',
            approval: { approvedActiveLimit: 160, decision: 'go', reviewerType: null, historical: true },
            session: { current: false, staleReason: 'current_session_missing',
                controlPlaneAccepted: false },
            capacity: { dataActive: 0, active: 0, controlPlaneSubscriptionRequested: false } });
        expect(overallMonitorLabel(normalized, false, 'connected')).toBe('今日未啟動');
    });

    it('空結果文案只在當日 session、freshness、lease 與 data active 皆成立時宣稱監控啟動', () => {
        expect(emptyIntradayMonitorResultMessage(status(), false, 'connected')).toBe('監控已啟動，目前沒有達標結果。');
        expect(emptyIntradayMonitorResultMessage(status({ session: { ...status().session, current: false } }), false, 'connected'))
            .toContain('今日監控未啟動');
        expect(emptyIntradayMonitorResultMessage(status({ freshness: { ...status().freshness, fresh: false } }), false, 'connected'))
            .toContain('今日監控未啟動');
        expect(emptyIntradayMonitorResultMessage(status({ lease: { ...status().lease, acceptingEvents: false } }), false, 'connected'))
            .not.toContain('監控已啟動');
        expect(emptyIntradayMonitorResultMessage(status(), false, 'reconnecting')).toContain('正在重新連線');
        expect(emptyIntradayMonitorResultMessage(status(), false, 'paused')).toContain('本頁即時連線暫停');
    });

    it('輕量監控收尾後保留真實收尾狀態，不因 session 不再 current 誤報今日未啟動', () => {
        const closed = status({ runtimeMode: 'daily',
            session: { ...status().session, current: false, phase: 'ended' },
            dailyExecution: { state: 'ended', completedAt: '2026-09-04T05:35:00Z',
                completeCount: 2, partialCount: 0, lastSourceEventAt: null,
                lastAcceptedEventAt: null, liveCoverageBySymbol: null,
                streamDisconnectReason: null, resourceFault: null,
                nextBaselineState: 'collecting', nextBaselineReason: 'unknown',
                nextBaselineTradeDate: null, nextBaselineReadyCount: null,
                diagnosticsState: 'not_requested' } });
        expect(overallMonitorLabel(closed, false, 'connected')).toBe('已完整收尾');
        expect(emptyIntradayMonitorResultMessage(closed, false, 'connected'))
            .toContain('收尾後不再發送盤中通知');
        const partial = status({ ...closed, dailyExecution: {
            ...closed.dailyExecution!, state: 'partial', completeCount: 1, partialCount: 1 } });
        expect(overallMonitorLabel(partial, false, 'connected')).toBe('部分收尾');
        expect(emptyIntradayMonitorResultMessage(partial, false, 'connected'))
            .toContain('逐檔缺口');
        const failed = status({ ...closed, dailyExecution: {
            ...closed.dailyExecution!, state: 'failed', failureReason: 'summary_write_failed',
            completeCount: null, partialCount: null } });
        expect(overallMonitorLabel(failed, false, 'connected')).toBe('收尾失敗');
        expect(emptyIntradayMonitorResultMessage(failed, false, 'connected'))
            .toContain('已提交的逐分鐘資料與結果仍保留');
    });
});
