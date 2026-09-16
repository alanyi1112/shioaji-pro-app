import { describe, expect, it } from 'vitest';

import { buildDirect160StageBundle } from './build-direct-160-stage-bundle.mjs';
import { fixtureBaseline } from './fixtures/direct-160-baseline.mjs';
import { issueIntradayMonitorKbarSessionCloseAuthority } from './kbar-stream-adapter.mjs';
import { DIRECT_160_STORAGE } from './direct-160-storage.mjs';
import {
    buildDirect160TieredSessionEvidence,
    createDirect160GenerationGuard,
    createDirect160StageComponents,
    runDirect160DeterministicReplay,
    validateDirect160LiveInputs,
} from './direct-160-live-stage.mjs';
import { createTieredCohortManifests, createTieredStagePlan,
    validateTieredStageEvidenceBundle } from './tiered-capacity-stage-artifacts.mjs';

function artifacts() {
    const contracts = Array.from({ length: 200 }, (_, index) => ({ security_type: 'STK', region: 'TW',
        exchange: index % 2 ? 'OTC' : 'TSE', code: String(1001 + index), target_code: null }));
    const manifest = createTieredCohortManifests({
        config: { revision: 4, items: contracts.map((item) => ({ contract: item, enabled: true })) },
        contracts, sourceVersion: '1.7.1', createdAt: '2026-09-11T14:00:00+08:00',
    })[160];
    const plan = createTieredStagePlan({ manifest, createdAt: '2026-09-11T14:01:00+08:00', budgets: {
        maxCpuBasisPoints: 2500, maxRssBytes: 1_073_741_824, maxDatabaseGrowthBytes: 33_554_432,
        minimumAvailableDiskBytes: DIRECT_160_STORAGE.minimumAvailableDiskBytes,
        maxEventToSealLatencyMs: 10_000, maxChartFreshnessMs: 10_000,
        reconnectRequired: true, existingFeaturesRequired: true,
    } });
    return { manifest, plan, baseline: fixtureBaseline(manifest) };
}

function event(entry, minute) {
    const hour = Math.floor(minute / 60);
    const part = minute % 60;
    const key = `${String(hour).padStart(2, '0')}:${String(part).padStart(2, '0')}`;
    return { schemaVersion: 'intraday-monitor-kbar-event/1', code: entry.contractIdentity.code,
        date: '2026/09/14', time: `${key}:00`, volume: 1,
        receivedTime: `2026-09-14T${key}:02+08:00`, connectionGeneration: 'direct_160_generation_fresh_0001',
        unit: 'common_lot', sourceVersion: 'shioaji-http-1.7.1' };
}

describe('direct 160 live stage', () => {
    it('exact 160 × 270 可保存、重播兩次並建立正式 stage session', () => {
        const { manifest, plan, baseline } = artifacts();
        expect(validateDirect160LiveInputs({ manifest, plan, baseline, tradeDate: '2026-09-14' }))
            .toEqual({ valid: true, reasons: [] });
        const { session } = createDirect160StageComponents({ manifest, plan, baseline,
            tradeDate: '2026-09-14', connectionGeneration: 'direct_160_generation_fresh_0001',
            now: () => '2026-09-14T08:50:00+08:00',
            nowEpochMs: () => Date.parse('2026-09-14T13:35:00+08:00') });
        for (let minute = 9 * 60 + 1; minute <= 13 * 60 + 30; minute += 1) {
            for (const entry of manifest.cohort) expect(session.recordKbar(event(entry, minute)).accepted).toBe(true);
        }
        const delayedCloseEntry = manifest.cohort[0];
        expect(session.recordKbar({
            ...event(delayedCloseEntry, 13 * 60 + 33),
            volume: 7,
        })).toMatchObject({
            accepted: true,
            reason: 'delayed_close_forming',
            sealed: false,
        });
        const closeAt = Date.parse('2026-09-14T13:34:30+08:00');
        const authority = issueIntradayMonitorKbarSessionCloseAuthority({ tradeDate: '2026-09-14',
            observedAtEpochMs: closeAt, timeZone: 'Asia/Taipei' }, closeAt);
        expect(session.sealSessionClose(authority)).toMatchObject({ accepted: true, sealedCount: 160 });
        const raw = session.evidence({ endedAt: '2026-09-14T13:34:31+08:00' });
        expect(raw).toMatchObject({ storageProfile: DIRECT_160_STORAGE.schemaVersion,
            assessment: { fullSession: true }, close: { expectedCount: 160 } });
        expect(raw.symbols).toHaveLength(160);
        expect(raw.symbols.every((symbol) => symbol.rows.length === 270)).toBe(true);
        expect(raw.symbols.every((symbol) => symbol.slots.length === 270 &&
            symbol.slots.every((slot) => slot.completeness === 'complete' && slot.reason === 'provider_kbar_observed'))).toBe(true);
        expect(raw.symbols[0]).toMatchObject({ closeMode: 'delayed_13_33', complete: true,
            minuteCount: 270, lastMinute: '13:30', nominalCloseMinute: '13:30',
            delayedCloseState: 'observed_and_folded',
            actualLastEvent: { minuteKey: '13:30', exchangeTime: '13:33:00' },
            closeEvidence: { status: 'verified', mode: 'delayed_13_33',
                authority: 'bounded_session_close_authority' },
            sealTime: '2026-09-14T05:34:30.000Z' });
        expect(raw.symbols[0].expectedMinuteSet).toHaveLength(270);
        expect(raw.symbols[0].rows.at(-1)).toMatchObject({ minuteKey: '13:30',
            cumulativeVolume: 277, sequence: 270 });
        expect(raw.symbols.slice(1).every((symbol) =>
            symbol.closeMode === 'normal_or_revised_13_30')).toBe(true);
        expect(raw.assessment.unknownSlotCount).toBe(0);
        const replay = runDirect160DeterministicReplay({ session: raw, baseline, manifest });
        expect(replay).toMatchObject({ runCount: 2, consistent: true, stepCount: 43_200,
            unknown: 0, notificationDispatchCount: 0 });
        const tiered = buildDirect160TieredSessionEvidence({ plan, manifest, baseline, session: raw,
            replay, transport: { startReceipt: { subscribeAccepted: true },
                stopReceipt: { unsubscribeAccepted: true } },
            resources: { cpuBasisPoints: 100, maxRssBytes: 256_000_000, databaseGrowthBytes: 1_000_000,
                minimumAvailableDiskBytes: 10_000_000_000, maxEventToSealLatencyMs: 500,
                maxChartFreshnessMs: 1_000 },
            assurances: { reconnectVerified: true, existingFeaturesHealthy: true } });
        expect(tiered).toMatchObject({ exactCohortCount: 160, minuteSlotCount: 43_200,
            complete: true, baselineHash: baseline.baselineHash });
        const bundle = buildDirect160StageBundle({ plan, manifest, baseline,
            capture: { schemaVersion: 'intraday-monitor-direct-160-capture/1', captureMode: 'full-session',
                interrupted: false, assessment: { readyForBundle: true }, tieredSession: tiered,
                planHash: plan.planHash, manifestHash: manifest.manifestHash,
                baselineHash: baseline.baselineHash },
            createdAt: '2026-09-14T13:35:00+08:00' });
        expect(validateTieredStageEvidenceBundle(bundle)).toMatchObject({
            valid: true, readyForHumanReview: true, completeTradingDays: 1,
        });
    }, 30_000);

    it('generation 只可 claim/release 一次且永不重用', () => {
        const guard = createDirect160GenerationGuard();
        const manifestHash = 'a'.repeat(64);
        expect(guard.claim({ connectionGeneration: 'direct_160_generation_1', manifestHash })).toMatchObject({ accepted: true });
        expect(() => guard.claim({ connectionGeneration: 'direct_160_generation_2', manifestHash })).toThrow('not_fresh');
        expect(guard.release({ connectionGeneration: 'direct_160_generation_1', manifestHash }))
            .toMatchObject({ accepted: true, reusable: false, providerReleaseProven: false });
        expect(() => guard.release({ connectionGeneration: 'direct_160_generation_1', manifestHash })).toThrow('release_mismatch');
    });

    it('任一分鐘缺漏保留 unknown slot，且 replay fail closed', () => {
        const { manifest, plan, baseline } = artifacts();
        const { session } = createDirect160StageComponents({ manifest, plan, baseline,
            tradeDate: '2026-09-14', connectionGeneration: 'direct_160_generation_partial_1',
            now: () => '2026-09-14T08:50:00+08:00',
            nowEpochMs: () => Date.parse('2026-09-14T13:35:00+08:00') });
        for (let minute = 9 * 60 + 2; minute <= 13 * 60 + 30; minute += 1) {
            for (const entry of manifest.cohort) session.recordKbar({
                ...event(entry, minute), connectionGeneration: 'direct_160_generation_partial_1',
            });
        }
        const closeAt = Date.parse('2026-09-14T13:34:30+08:00');
        session.sealSessionClose(issueIntradayMonitorKbarSessionCloseAuthority({ tradeDate: '2026-09-14',
            observedAtEpochMs: closeAt, timeZone: 'Asia/Taipei' }, closeAt));
        const raw = session.evidence({ endedAt: '2026-09-14T13:34:31+08:00' });
        expect(raw.assessment).toMatchObject({ fullSession: false, unknownSlotCount: 160 });
        expect(raw.symbols[0].slots[0]).toMatchObject({ minuteKey: '09:01', completeness: 'unknown',
            reason: 'provider_kbar_missing', cumulativeVolume: null });
        expect(() => runDirect160DeterministicReplay({ session: raw, baseline, manifest }))
            .toThrow('direct 160 replay input is invalid');
    }, 30_000);
});
