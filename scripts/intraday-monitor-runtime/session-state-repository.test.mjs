import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    IntradayMonitorSessionStateRepository,
    createCapacityApprovalRecord,
    createDailySessionRecord,
} from './session-state-repository.mjs';
import { legacyProductStateV1Fixture } from './fixtures/legacy-product-state-v1.mjs';

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }))));

function approval(bundleHash = 'a'.repeat(64)) {
    return createCapacityApprovalRecord({
        approvedActiveLimit: 160,
        stage: 160,
        decision: 'go',
        reviewerType: 'codex_delegated',
        reviewerId: 'codex-delegated-review',
        reviewedAt: '2026-09-16T14:13:31+08:00',
        evidenceTradeDate: '2026-09-16',
        artifactBundleHash: bundleHash,
        authorizationProvenance: 'user_delegated_evidence_review',
        providerEvidence: {
            physicalUsage: null,
            otherUsage: null,
            globalOwnershipComplete: null,
            releaseProven: null,
            headroom: null,
        },
    });
}

function session(approvalHash, patch = {}) {
    return createDailySessionRecord({
        sessionId: 'session-2026-09-22-revision-8',
        tradeDate: '2026-09-22',
        previousTradeDate: '2026-09-21',
        configRevision: 8,
        cohortHash: 'b'.repeat(64),
        baselineHash: null,
        artifactBundleHash: 'a'.repeat(64),
        approvalHash,
        connectionGeneration: 'simulation:generation-20260922',
        schedulerReceiptHash: 'c'.repeat(64),
        calendarAuthority: {
            current: true,
            tradeDate: '2026-09-22',
            previousTradeDate: '2026-09-21',
            isTradingDate: true,
            source: 'fixture official calendar',
            sourceVersions: ['fixture-calendar-v1'],
            observedAt: '2026-09-22T08:20:00+08:00',
        },
        phase: 'waiting_baseline',
        itemStates: [{ canonicalSymbol: '2330.TW', state: 'waiting_baseline',
            reason: 'baseline_missing', baselineState: 'missing', subscriptionState: 'none',
            firstKbarAt: null, updatedAt: '2026-09-22T08:20:00+08:00' }],
        controlPlane: { requested: false, accepted: false },
        freshness: { evidenceAt: null, budgetMs: 0 },
        createdAt: '2026-09-22T08:20:00+08:00',
        ...patch,
    });
}

describe('盤中監控 approval 與 daily session repository', () => {
    it('分開保存 durable approval 與 daily session，重複相同 claim 為冪等', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'intraday-session-state-'));
        roots.push(root);
        const repository = new IntradayMonitorSessionStateRepository(root);
        const savedApproval = repository.writeApproval(approval());
        const daily = session(savedApproval.approvalHash);
        expect(repository.claimSession(daily)).toEqual(daily);
        expect(repository.claimSession(daily)).toEqual(daily);
        expect(repository.readApproval()).toEqual(savedApproval);
        expect(repository.readSession('2026-09-22')).toEqual(daily);
    });

    it('拒絕同交易日不同 identity 的 exclusive claim', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'intraday-session-claim-'));
        roots.push(root);
        const repository = new IntradayMonitorSessionStateRepository(root);
        const savedApproval = repository.writeApproval(approval());
        repository.claimSession(session(savedApproval.approvalHash));
        const conflict = session(savedApproval.approvalHash, {
            sessionId: 'session-2026-09-22-revision-9',
            configRevision: 9,
        });
        expect(() => repository.claimSession(conflict)).toThrow('daily_session_claim_conflict');
    });

    it('損毀檔案 fail closed，且不把 approval 轉成 current session', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'intraday-session-corrupt-'));
        roots.push(root);
        const repository = new IntradayMonitorSessionStateRepository(root);
        repository.writeApproval(approval());
        await writeFile(repository.paths.approvalPath, '{broken', 'utf8');
        expect(repository.readApproval()).toBeNull();
        expect(repository.readSession('2026-09-22')).toBeNull();
    });

    it('legacy v1 migration 只建立 historical approval 且可安全重跑', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'intraday-legacy-migration-'));
        roots.push(root);
        const repository = new IntradayMonitorSessionStateRepository(root);
        const legacy = legacyProductStateV1Fixture();
        const first = repository.migrateLegacyProductState(legacy, {
            artifactBundleHash: 'a'.repeat(64),
        });
        const second = repository.migrateLegacyProductState(legacy, {
            artifactBundleHash: 'a'.repeat(64),
        });
        expect(second.approval.approvalHash).toBe(first.approval.approvalHash);
        expect(second.migration).toMatchObject({
            historicalOnly: true,
            currentSessionCreated: false,
            subscriptionAuthority: false,
            resultsAuthority: false,
            notificationAuthority: false,
        });
        await expect(readFile(repository.sessionPath('2026-09-16'), 'utf8'))
            .rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('只在 160 檔零活動時留下 append-only receipt 並推進 generation epoch', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'intraday-generation-recovery-'));
        roots.push(root);
        const repository = new IntradayMonitorSessionStateRepository(root);
        const savedApproval = repository.writeApproval(approval());
        const itemStates = Array.from({ length: 160 }, (_, index) => ({
            canonicalSymbol: `${String(1000 + index)}.TW`, state: 'waiting_baseline',
            reason: 'baseline_missing', baselineState: 'missing', subscriptionState: 'none',
            firstKbarAt: null, updatedAt: '2026-09-22T08:20:00+08:00',
        }));
        const original = repository.claimSession(session(savedApproval.approvalHash, { itemStates }));
        const evidence = { apiSimulation: true, businessSession: true, snapshot2330: true,
            calendarVerified: true, artifactVerified: true, configRevisionVerified: true,
            noCurrentResults: true };
        const recovered = repository.rebindUnstartedSessionGeneration({
            tradeDate: original.tradeDate, expectedSessionIdentityHash: original.sessionIdentityHash,
            newGeneration: 'simulation:generation-20260922-new', schedulerStep: '08:35',
            observedAt: '2026-09-22T08:35:00+08:00', evidence,
        });
        expect(recovered.session).toMatchObject({
            connectionGeneration: 'simulation:generation-20260922-new', generationEpoch: 1,
            generationRecoveryIds: [recovered.transition.transitionId],
            sessionId: original.sessionId, controlPlane: { requested: false, accepted: false },
        });
        expect(recovered.transition).toMatchObject({
            previousGeneration: original.connectionGeneration,
            priorSessionIdentityHash: original.sessionIdentityHash,
            brokerWriteAuthority: false, productionAuthority: false,
        });
        const receipt = await readFile(recovered.transitionPath, 'utf8');
        expect(() => repository.rebindUnstartedSessionGeneration({
            tradeDate: original.tradeDate, expectedSessionIdentityHash: original.sessionIdentityHash,
            newGeneration: 'simulation:generation-20260922-new', schedulerStep: '08:35',
            observedAt: '2026-09-22T08:35:00+08:00', evidence,
        })).toThrow('generation_recovery_identity_mismatch');
        expect(await readFile(recovered.transitionPath, 'utf8')).toBe(receipt);
    });

    it('已訂閱或已收到 KBar 時，generation mismatch 不得重綁', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'intraday-generation-active-'));
        roots.push(root);
        const repository = new IntradayMonitorSessionStateRepository(root);
        const savedApproval = repository.writeApproval(approval());
        const itemStates = Array.from({ length: 160 }, (_, index) => ({
            canonicalSymbol: `${String(1000 + index)}.TW`, state: 'awaiting_first_kbar',
            reason: 'awaiting_first_kbar', baselineState: 'complete', subscriptionState: 'none',
            firstKbarAt: null, updatedAt: '2026-09-22T08:20:00+08:00',
        }));
        const original = repository.claimSession(session(savedApproval.approvalHash, {
            phase: 'starting', baselineHash: 'd'.repeat(64), itemStates,
        }));
        const evidence = { apiSimulation: true, businessSession: true, snapshot2330: true,
            calendarVerified: true, artifactVerified: true, configRevisionVerified: true,
            noCurrentResults: true };
        const attempt = (expectedSessionIdentityHash) => () =>
            repository.rebindUnstartedSessionGeneration({ tradeDate: original.tradeDate,
                expectedSessionIdentityHash, newGeneration: 'simulation:generation-20260922-new',
                schedulerStep: '08:45', observedAt: '2026-09-22T08:45:00+08:00', evidence });
        let active = repository.updateSession({ ...original,
            controlPlane: { requested: true, accepted: false } });
        expect(attempt(active.sessionIdentityHash)).toThrow('generation_recovery_data_activity_present');
        active = repository.updateSession({ ...active,
            controlPlane: { requested: false, accepted: false },
            itemStates: active.itemStates.map((item, index) => index === 0
                ? { ...item, firstKbarAt: '2026-09-22T08:44:00+08:00' } : item) });
        expect(attempt(active.sessionIdentityHash)).toThrow('generation_recovery_data_activity_present');
        expect(repository.readSession(original.tradeDate).connectionGeneration)
            .toBe(original.connectionGeneration);
    });
});
