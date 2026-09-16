import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { reviewAndActivateDirect160Product } from './activate-direct-160-product.mjs';
import { buildDirect160StageBundle } from './build-direct-160-stage-bundle.mjs';
import { fixtureBaseline } from './fixtures/direct-160-baseline.mjs';
import { DIRECT_160_STORAGE } from './direct-160-storage.mjs';
import { reviewDirect160TailGapCapture } from './direct-160-tail-gap-review.mjs';
import { validateDirect160LiveAcceptanceCapture,
    createDirect160ProductSink, validateDirect160TailGapReview } from './direct-160-product-runtime.mjs';
import { createTieredCohortManifests, createTieredStagePlan } from './tiered-capacity-stage-artifacts.mjs';

const MINUTES = Array.from({ length: 270 }, (_, index) => {
    const minute = 9 * 60 + 1 + index;
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
});

function artifacts() {
    const contracts = Array.from({ length: 160 }, (_, index) => ({ security_type: 'STK', region: 'TW',
        exchange: index % 2 ? 'OTC' : 'TSE', code: String(1001 + index), target_code: null }));
    const manifest = createTieredCohortManifests({ contracts,
        config: { revision: 4, items: contracts.map((contract) => ({ contract, enabled: true })) },
        sourceVersion: 'fixture-only/1', createdAt: '2026-09-13T14:00:00+08:00' })[160];
    const baseline = fixtureBaseline(manifest);
    const plan = createTieredStagePlan({ manifest, createdAt: '2026-09-14T08:45:00+08:00', budgets: {
        maxCpuBasisPoints: 2_500, maxRssBytes: 1_073_741_824,
        maxDatabaseGrowthBytes: 67_108_864, minimumAvailableDiskBytes: DIRECT_160_STORAGE.minimumAvailableDiskBytes,
        maxEventToSealLatencyMs: 10_000, maxChartFreshnessMs: 10_000,
        reconnectRequired: true, existingFeaturesRequired: true,
    } });
    return { manifest, baseline, plan };
}

function liveRow(symbol, minuteKey, index) {
    return { canonicalSymbol: symbol, minuteKey, exchangeTime: `${minuteKey}:00.000000`,
        cumulativeVolume: index + 1, sequence: index + 1,
        receivedTime: `2026-09-14T${minuteKey}:02+08:00`, sealedAt: `2026-09-14T${minuteKey}:02+08:00`,
        sourceVersion: 'shioaji-http-1.7.1', unit: 'common_lot', completeness: 'complete',
        reason: 'provider_kbar_observed' };
}

function captureFixture({ manifest, plan, baseline, affected = 1, missingCount = 2,
    mutateCandidate } = {}) {
    const candidates = new Set(manifest.cohort.slice(0, affected).map((entry) => entry.canonicalSymbol));
    const symbols = manifest.cohort.map((entry) => {
        const missing = candidates.has(entry.canonicalSymbol) ? missingCount : 0;
        const rows = MINUTES.slice(0, MINUTES.length - missing)
            .map((minuteKey, index) => liveRow(entry.canonicalSymbol, minuteKey, index));
        const slots = [...rows, ...MINUTES.slice(MINUTES.length - missing).map((minuteKey) => ({
            canonicalSymbol: entry.canonicalSymbol, minuteKey, cumulativeVolume: null,
            completeness: 'unknown', reason: 'provider_kbar_missing', receivedTime: null,
            sealedAt: null, sequence: null, sourceVersion: null, unit: 'common_lot',
        }))];
        const value = { canonicalSymbol: entry.canonicalSymbol, complete: missing === 0,
            minuteCount: rows.length, firstMinute: '09:01', lastMinute: rows.at(-1).minuteKey,
            rows, slots, expectedMinuteSet: MINUTES, nominalCloseMinute: '13:30',
            delayedCloseState: 'not_observed', closeMode: missing ? 'incomplete' : 'normal_or_revised_13_30',
            actualLastEvent: { minuteKey: rows.at(-1).minuteKey },
            closeEvidence: { status: missing ? 'unresolved' : 'verified',
                mode: missing ? 'pending' : 'normal_or_revised_13_30', authority: null,
                finalizedAt: '2026-09-14T05:34:30.000Z' }, sealTime: '2026-09-14T05:34:30.000Z' };
        return candidates.has(entry.canonicalSymbol) && mutateCandidate ? mutateCandidate(value) : value;
    });
    return { schemaVersion: 'intraday-monitor-direct-160-capture/1', captureMode: 'full-session',
        interrupted: false, tradeDate: '2026-09-14', manifestHash: manifest.manifestHash,
        planHash: plan.planHash, baselineHash: baseline.baselineHash,
        session: { tradeDate: '2026-09-14', connectionGeneration: 'fixture_generation_20260914_0001',
            cohort: manifest.cohort, symbols, assessment: { fullSession: false, baselineEligible: false,
                notificationEligible: false, unknownSlotCount: affected * missingCount },
            close: { accepted: false, sealedCount: 160 } },
        runtime: { firstMinuteCanary: { result: 'pass', expectedCount: 160, receivedCount: 160,
            missingCount: 0, liveAvailabilityComplete: true }, localEventReconnect: { recovered: true },
        passiveChartEvidenceHash: 'c'.repeat(64) },
        transport: { startReceipt: { subscribeAccepted: true }, stopReceipt: { unsubscribeAccepted: true },
            status: { malformedFrames: 0 } },
        resources: { cpuBasisPoints: 100, maxRssBytes: 200_000_000, databaseGrowthBytes: 1_000_000,
            minimumAvailableDiskBytes: 10_000_000_000, maxEventToSealLatencyMs: 100,
            maxChartFreshnessMs: 1_000 },
        operations: { notificationDispatches: 0, brokerWrites: 0, productionTransitions: 0,
            serviceLifecycleMutations: 0, activeLimitMutations: 0 },
        assessment: { liveAvailabilityComplete: true, dataContinuityComplete: false,
            formalAcceptanceEvidence: false, readyForBundle: false } };
}

function historicalPayload({ lastVolume = 1, firstVolume = 1 } = {}) {
    const volume = MINUTES.map((_, index) => index === 0 ? firstVolume : index === 269 ? lastVolume : 1);
    return { datetime: MINUTES.map((minute) => `2026-09-14T${minute}:00+08:00`),
        Open: MINUTES.map(() => 100), High: MINUTES.map(() => 101), Low: MINUTES.map(() => 99),
        Close: MINUTES.map(() => 100), Volume: volume, Amount: MINUTES.map(() => 100_000) };
}

function fetchFixture(payloads = [historicalPayload(), historicalPayload()]) {
    let kbar = 0;
    return async (url) => ({ ok: true, text: async () => JSON.stringify(url.endsWith('/api/v1/info')
        ? { simulation: true, version: '1.7.1' } : payloads[Math.min(kbar++, payloads.length - 1)]) });
}

async function review(options = {}) {
    const values = artifacts();
    const capture = captureFixture({ ...values, ...options });
    return reviewDirect160TailGapCapture({ ...values, capture, sourceCaptureSha256: 'a'.repeat(64),
        fetchImpl: options.fetchImpl ?? fetchFixture(), reviewedAt: '2026-09-14T14:00:00+08:00' });
}

describe('direct 160 收盤尾端缺口 review', () => {
    it('1 檔少最後 2 分鐘可由穩定雙抓補齊，且歷史列沒有通知權限', async () => {
        const derived = await review();
        expect(derived.tailGapReview).toMatchObject({ affectedSymbolCount: 1,
            postCloseDataContinuityComplete: true, notificationAuthority: false });
        expect(derived.session.symbols[0].rows.slice(-2).every((row) => row.liveDelivered === false)).toBe(true);
        expect(derived.replay).toMatchObject({ stepCount: 43_200, notificationDispatchCount: 0 });
        expect(validateDirect160TailGapReview(derived)).toBe(true);
        expect(validateDirect160LiveAcceptanceCapture(derived)).toBe(true);
    }, 30_000);

    it('最多 4 檔、各少最後 5 分鐘仍可通過', async () => {
        const derived = await review({ affected: 4, missingCount: 5 });
        expect(derived.tailGapReview.affectedSymbolCount).toBe(4);
        expect(derived.tailGapReview.repairs.every((item) => item.missingMinutes[0] === '13:26')).toBe(true);
    }, 30_000);

    it('可把原始 failed state 送回 review 後原子啟用 160，且只增加一次上限異動', async () => {
        const values = artifacts();
        const capture = captureFixture({ ...values });
        const derived = await reviewDirect160TailGapCapture({ ...values, capture,
            sourceCaptureSha256: 'a'.repeat(64), fetchImpl: fetchFixture(),
            reviewedAt: '2026-09-14T14:00:00+08:00' });
        const bundle = buildDirect160StageBundle({ ...values, capture: derived,
            createdAt: '2026-09-14T14:01:00+08:00' });
        const root = await mkdtemp(path.join(os.tmpdir(), 'direct-160-tail-activation-'));
        const statePath = path.join(root, 'state.json');
        const config = { revision: 4, globalThreshold: '1', items: values.manifest.cohort.map((entry) => ({
            contract: { securityType: 'STK', region: 'TW', exchange: entry.contractIdentity.exchange,
                code: entry.contractIdentity.code, targetCode: null, canonicalSymbol: entry.canonicalSymbol },
            enabled: true, thresholdOverride: null,
        })) };
        const sink = createDirect160ProductSink({ manifest: values.manifest, baseline: values.baseline,
            config, tradeDate: '2026-09-14', connectionGeneration: 'fixture_generation_20260914_0001',
            evidenceDatabasePath: path.join(root, 'evidence.sqlite3'), statePath });
        sink.installBaselines();
        sink.fail('full_session_incomplete');
        const result = await reviewAndActivateDirect160Product({ capture: derived, bundle, statePath,
            reviewPath: path.join(root, 'review.json'), reviewedAt: '2026-09-14T14:02:00+08:00' });
        expect(result.state).toMatchObject({ phase: 'complete_go', evaluationState: 'go',
            approvedActiveLimit: 160, operations: { activeLimitMutations: 1 } });
        expect(result.state.items.every((item) => item.state === 'active')).toBe(true);
    }, 30_000);

    it('5 檔缺尾端資料必須拒絕', async () => {
        await expect(review({ affected: 5 })).rejects.toThrow('tail_gap_symbol_limit_exceeded');
    });

    it('缺口早於 13:26 必須拒絕', async () => {
        await expect(review({ missingCount: 6 })).rejects.toThrow('tail_gap_policy_exceeded');
    });

    it('非連續尾端缺口必須拒絕', async () => {
        await expect(review({ mutateCandidate: (item) => ({ ...item,
            rows: item.rows.filter((row) => row.minuteKey !== '13:27'),
            slots: item.slots.map((slot) => slot.minuteKey === '13:27'
                ? { ...slot, completeness: 'unknown', reason: 'provider_kbar_missing' } : slot),
        }) })).rejects.toThrow('tail_gap_policy_exceeded');
    });

    it('兩次盤後 KBar 內容漂移必須拒絕', async () => {
        await expect(review({ fetchImpl: fetchFixture([historicalPayload(),
            historicalPayload({ lastVolume: 2 })]) })).rejects.toThrow('tail_gap_historical_refetch_drift');
    });

    it('盤後資料與盤中累積量前綴衝突必須拒絕', async () => {
        await expect(review({ fetchImpl: fetchFixture([historicalPayload({ firstVolume: 2 }),
            historicalPayload({ firstVolume: 2 })]) })).rejects.toThrow('tail_gap_live_prefix_conflict');
    });
});
