import { describe, expect, it } from 'vitest';

import {
    evaluateIntradayMonitorCurrentSession,
    normalizeIntradayMonitorSessionItems,
} from './current-session-authority.mjs';

function input(patch = {}) {
    const approval = { approvalHash: 'a'.repeat(64), decision: 'go', approvedActiveLimit: 160 };
    const session = {
        tradeDate: '2026-09-22',
        previousTradeDate: '2026-09-21',
        approvalHash: approval.approvalHash,
        artifactBundleHash: 'b'.repeat(64),
        configRevision: 8,
        connectionGeneration: 'simulation:generation-20260922',
        baselineHash: 'c'.repeat(64),
        phase: 'running',
        freshness: { evidenceAt: '2026-09-22T09:01:30+08:00' },
    };
    return {
        authority: { current: true, tradeDate: '2026-09-22', previousTradeDate: '2026-09-21' },
        session,
        approval,
        artifactBundle: { valid: true, bundleHash: session.artifactBundleHash },
        savedConfigRevision: 8,
        apiGeneration: session.connectionGeneration,
        nowEpochMs: Date.parse('2026-09-22T09:02:00+08:00'),
        ...patch,
    };
}

describe('current-session authority', () => {
    it('只有完整 identity 與新鮮 evidence 才授予今日 data/results/notification authority', () => {
        expect(evaluateIntradayMonitorCurrentSession(input())).toMatchObject({
            current: true,
            reason: null,
            fresh: true,
            dataPlaneAuthority: true,
            resultsAuthority: true,
            notificationAuthority: true,
            brokerWriteAuthority: false,
        });
    });

    it.each([
        ['current session 缺失', { session: null }, 'current_session_missing'],
        ['trade date stale', { authority: { current: true, tradeDate: '2026-09-23', previousTradeDate: '2026-09-22' } }, 'session_trade_date_stale'],
        ['revision 漂移', { savedConfigRevision: 9 }, 'config_revision_mismatch'],
        ['generation 漂移', { apiGeneration: 'simulation:different-generation' }, 'generation_mismatch'],
        ['bundle 無效', { artifactBundle: { valid: false, bundleHash: 'b'.repeat(64) } }, 'artifact_bundle_invalid'],
        ['evidence 過期', { nowEpochMs: Date.parse('2026-09-22T09:10:00+08:00') }, 'evidence_stale'],
        ['08:50 採集失敗', { premarketCaptureFailure: 'direct_160_capture_failed' }, 'premarket_capture_failed'],
    ])('%s 時 fail closed', (_name, patch, reason) => {
        expect(evaluateIntradayMonitorCurrentSession(input(patch))).toMatchObject({
            current: false,
            reason,
            dataPlaneAuthority: false,
            resultsAuthority: false,
            notificationAuthority: false,
        });
    });

    it('freshness budget 邊界採含端點，超過 1ms 即失去 authority', () => {
        expect(evaluateIntradayMonitorCurrentSession(input({
            nowEpochMs: Date.parse('2026-09-22T09:03:30+08:00'),
        }))).toMatchObject({ current: true, ageMs: 120_000, budgetMs: 120_000 });
        expect(evaluateIntradayMonitorCurrentSession(input({
            nowEpochMs: Date.parse('2026-09-22T09:03:30.001+08:00'),
        }))).toMatchObject({ current: false, reason: 'evidence_stale', ageMs: 120_001 });
    });

    it('closing 使用獨立十分鐘預算，逾時仍 fail closed', () => {
        const closing = { ...input().session, phase: 'closing',
            freshness: { evidenceAt: '2026-09-22T13:29:45+08:00' } };
        expect(evaluateIntradayMonitorCurrentSession(input({ session: closing,
            nowEpochMs: Date.parse('2026-09-22T13:39:45+08:00'),
        }))).toMatchObject({ current: true, phase: 'closing', ageMs: 600_000,
            budgetMs: 600_000 });
        expect(evaluateIntradayMonitorCurrentSession(input({ session: closing,
            nowEpochMs: Date.parse('2026-09-22T13:39:45.001+08:00'),
        }))).toMatchObject({ current: false, reason: 'evidence_stale', ageMs: 600_001 });
    });

    it('重現 2026-10-02 原始尾盤時間差：running 過期，及時轉 closing 則仍可收尾', () => {
        const base = input();
        const session = { ...base.session, tradeDate: '2026-10-02',
            previousTradeDate: '2026-10-01',
            freshness: { evidenceAt: '2026-10-02T05:30:39.585Z' } };
        const atClose = { ...base,
            authority: { current: true, tradeDate: '2026-10-02',
                previousTradeDate: '2026-10-01' },
            session, nowEpochMs: Date.parse('2026-10-02T05:34:30.001Z') };
        expect(evaluateIntradayMonitorCurrentSession(atClose)).toMatchObject({
            current: false, reason: 'evidence_stale', phase: 'running', ageMs: 230_416,
            budgetMs: 120_000, dataPlaneAuthority: false,
        });
        expect(evaluateIntradayMonitorCurrentSession({ ...atClose,
            session: { ...session, phase: 'closing' },
        })).toMatchObject({
            current: true, phase: 'closing', ageMs: 230_416, budgetMs: 600_000,
            evidenceAt: '2026-10-02T05:30:39.585Z', dataPlaneAuthority: true,
        });
    });

    it('互斥 state 總和等於 configured，baseline summary 與 waitingBaseline 分開', () => {
        const configuredItems = Array.from({ length: 200 }, (_, index) => ({
            canonicalSymbol: `${String(1000 + index)}.TW`, enabled: true, eligible: true,
        }));
        const sessionItems = configuredItems.slice(0, 160).map((item, index) => ({
            canonicalSymbol: item.canonicalSymbol,
            state: index < 149 ? 'active' : 'degraded',
            reason: index < 149 ? 'none' : 'subscription_confirmation_unknown',
            baselineState: index < 149 ? 'complete' : 'unknown',
            baselineTradeDate: index < 149 ? '2026-09-21' : null,
            subscriptionState: index < 149 ? 'confirmed' : 'unknown',
            firstKbarAt: index < 149 ? '2026-09-22T09:01:10+08:00' : null,
            updatedAt: '2026-09-22T09:02:00+08:00',
        }));
        const projected = normalizeIntradayMonitorSessionItems({
            configuredItems,
            sessionItems,
            approvedActiveLimit: 160,
            currentSession: { current: true },
        });
        expect(projected.capacity).toMatchObject({
            configured: 200,
            admitted: 160,
            dataActive: 149,
            waitingPilotLimit: 40,
            waitingBaseline: 0,
            degraded: 11,
        });
        expect(projected.baselineSummary).toMatchObject({ complete: 149, unknown: 51 });
    });
});
