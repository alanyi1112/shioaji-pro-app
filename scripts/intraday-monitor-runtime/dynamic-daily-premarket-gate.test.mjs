import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { INTRADAY_MONITOR_CONFIG_SCHEMA, validateIntradayMonitorConfig }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA }
    from './trading-calendar-authority.mjs';
import { createDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { writeDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { readDynamicDailyActivePlan } from './dynamic-daily-active-plan.mjs';
import { sealDynamicDailyBaselineGate, sealDynamicDailyFinalGate }
    from './dynamic-daily-premarket-orchestrator.mjs';
import { DYNAMIC_DAILY_SESSION_PROOF_SCHEMA }
    from './dynamic-daily-session-proof.mjs';
import { dynamicDailySymbolBaselineCohortHash,
    resolveDynamicDailyBaselineCoverage } from './dynamic-daily-baseline-resolver.mjs';
import { HISTORICAL_KBAR_BASELINE_CANDIDATE_SCHEMA,
    computeHistoricalKbarPayloadHash, expectedTaiwanRegularSessionMinutes,
    validateAndBuildHistoricalKbarBaseline } from './historical-kbar-repair.mjs';
import { createDynamicDailyBaselineGateReceipt, createDynamicDailyFinalGateReceipt,
    writeDynamicDailyGateReceipt } from './dynamic-daily-premarket-gate.mjs';

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }))); });

function fixturePlan(codes = ['2330']) {
    const result = validateIntradayMonitorConfig({ schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
        revision: 9, globalThreshold: '1.5', items: codes.map((code) => ({
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE', code,
                target_code: null }, enabled: true, thresholdOverride: null, source: 'manual' })) });
    expect(result.ok).toBe(true);
    return createDynamicDailyCohortPlan({ config: result.value,
        authority: { schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
            current: true, isTradingDate: true, tradeDate: '2026-09-30',
            previousTradeDate: '2026-09-29', sourceVersions: ['fixture-calendar/1'],
            observedAt: '2026-09-29T13:35:00+08:00' },
        approval: { decision: 'go', approvedActiveLimit: 160, approvalHash: 'a'.repeat(64) },
        createdAt: '2026-09-29T13:36:00+08:00' });
}

function manifestFor(code) {
    const symbol = `${code}.TW`;
    const minutes = expectedTaiwanRegularSessionMinutes();
    const arrays = { datetime: minutes.map((minute) =>
        `2026-09-29T${minute}:00+08:00`),
    Open: minutes.map(() => 100), High: minutes.map(() => 101),
    Low: minutes.map(() => 99), Close: minutes.map(() => 100),
    Volume: minutes.map(() => 10), Amount: minutes.map(() => 1_000) };
    const seed = { schemaVersion: HISTORICAL_KBAR_BASELINE_CANDIDATE_SCHEMA,
        symbol, exchange: 'TSE', securityType: 'STK', tradeDate: '2026-09-29',
        timeZone: 'Asia/Taipei', source: 'fixture-historical-kbars',
        sourceVersion: 'fixture/1', sourceUnit: 'common_lot', canonicalUnit: 'common_lot',
        volumeSemantics: 'minute_delta', closeEncoding: 'normal_13_30',
        arrays, knownZeroMinutes: [], previousClose: 99 };
    const first = { ...seed, fetchedAt: '2026-09-29T13:35:00+08:00' };
    const second = { ...seed, fetchedAt: '2026-09-29T13:36:00+08:00' };
    const result = validateAndBuildHistoricalKbarBaseline({
        authority: { officialTradingDay: true, identityVerified: true,
            instrumentStatus: 'normal', symbol, exchange: 'TSE', securityType: 'STK',
            tradeDate: '2026-09-29', targetTradeDate: '2026-09-30',
            previousApplicableTradeDate: '2026-09-29', timeZone: 'Asia/Taipei',
            calendarVerified: true, calendarSource: 'fixture-calendar',
            calendarSourceVersion: 'fixture-calendar/1' },
        finalVolumeAuthority: { status: 'verified', sessionScope: 'regular_session',
            unit: 'common_lot', volumeCommonLot: 2_700, symbol, exchange: 'TSE',
            tradeDate: '2026-09-29', source: 'fixture-official-close',
            sourceVersion: 'fixture-close/1' },
        candidate: { ...first, payloadHash: computeHistoricalKbarPayloadHash(first) },
        refetchCandidate: { ...second, payloadHash: computeHistoricalKbarPayloadHash(second) },
        cohortHash: dynamicDailySymbolBaselineCohortHash({ tradeDate: '2026-09-30',
            previousTradeDate: '2026-09-29', canonicalSymbol: symbol, exchange: 'TSE' }),
        now: '2026-09-29T13:36:30+08:00' });
    expect(result.ok).toBe(true);
    return result.manifest;
}

function fixture(codes = ['2330']) {
    const plan = fixturePlan(codes);
    const manifests = codes.map(manifestFor);
    const coverage = resolveDynamicDailyBaselineCoverage({ plan,
        standaloneManifests: manifests });
    const sources = manifests.map((manifest) => ({ manifest,
        sealedAt: '2026-09-29T13:37:00+08:00', sourceHash: manifest.manifestId }));
    return { plan, coverage, sources };
}

function baselineGate(input) {
    return createDynamicDailyBaselineGateReceipt({ ...input,
        checkedAt: '2026-09-30T08:35:00+08:00',
        officialCalendarCurrent: true, previousSessionFinalized: true });
}

describe('每日盤前基準與最終 Gate', () => {
    it('已落盤候選與兩階段收據才可啟用；失敗收據不啟用', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-gate-step-'));
        roots.push(root);
        const input = fixture();
        await writeDynamicDailyCohortPlan(root, input.plan);
        const authority = { schemaVersion:
            INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
            current: true, isTradingDate: true,
            tradeDate: input.plan.tradeDate,
            previousTradeDate: input.plan.previousTradeDate,
            sourceVersions: input.plan.calendarSourceVersions,
            observedAt: '2026-09-30T08:34:50+08:00' };
        const first = await sealDynamicDailyBaselineGate({ root, ...input,
            authority, previousSessionFinalized: true,
            checkedAt: '2026-09-30T08:35:10+08:00' });
        expect(first.outcome).toBe('ready');
        const baselineGate = JSON.parse(await readFile(first.receiptPath, 'utf8'));
        const proof = { schemaVersion: DYNAMIC_DAILY_SESSION_PROOF_SCHEMA,
            simulation: true, businessSessionCurrent: true,
            connectionGeneration: 'simulation:1234567890abcdef',
            snapshotTradeDate: '2026-09-30',
            observedAt: '2026-09-30T08:44:55+08:00',
            secondLogin: false, secondStream: false };
        const second = await sealDynamicDailyFinalGate({ root, plan: input.plan,
            baselineGate, authority, sessionProof: proof, savedConfigRevision: 9,
            checkedAt: '2026-09-30T08:45:05+08:00' });
        expect(second).toMatchObject({ outcome: 'ready',
            activePlanPath: expect.any(String), subscriptionAuthority: false });
        expect(await readDynamicDailyActivePlan(root, input.plan.tradeDate))
            .toMatchObject({ plan: { planHash: input.plan.planHash },
                baselineGate: { receiptHash: first.receiptHash },
                finalGate: { receiptHash: second.receiptHash } });

        const failedRoot = await mkdtemp(path.join(os.tmpdir(), 'daily-gate-failed-'));
        roots.push(failedRoot);
        await writeDynamicDailyCohortPlan(failedRoot, input.plan);
        const failedFirst = await sealDynamicDailyBaselineGate({ root: failedRoot,
            ...input, sources: [], authority, previousSessionFinalized: true,
            checkedAt: '2026-09-30T08:35:10+08:00' });
        const failedSecond = await sealDynamicDailyFinalGate({ root: failedRoot,
            plan: input.plan,
            baselineGate: JSON.parse(await readFile(failedFirst.receiptPath, 'utf8')),
            authority, sessionProof: proof, savedConfigRevision: 9,
            checkedAt: '2026-09-30T08:45:05+08:00' });
        expect(failedSecond).toMatchObject({ outcome: 'failed',
            activePlanPath: null });
        expect(await readDynamicDailyActivePlan(failedRoot, input.plan.tradeDate))
            .toBeNull();
    });

    it('08:35 前封存同商品完整基準，08:45 核對同一 plan 仍不冒充訂閱', () => {
        const input = fixture();
        const first = baselineGate(input);
        expect(first).toMatchObject({ outcome: 'ready', plannedCount: 1,
            baselineReadyCount: 1, exact160BaselineReady: false,
            notificationAuthority: false, subscriptionAuthority: false });
        const final = createDynamicDailyFinalGateReceipt({ plan: input.plan,
            baselineGate: first, checkedAt: '2026-09-30T08:45:05+08:00',
            savedConfigRevision: 9, officialCalendarCurrent: true,
            simulation: true, businessSessionCurrent: true,
            connectionGeneration: 'simulation:1234567890abcdef' });
        expect(final).toMatchObject({ outcome: 'ready',
            subscriptionRequestedCount: 0, dataActiveCount: 0,
            notificationAuthority: false, retroactiveAuthority: false });
    });

    it('一檔沒有封存證據時只核准部分就緒，其餘商品仍可由同一 plan 觀測', () => {
        const input = fixture(['2330', '2317']);
        const gate = baselineGate({ ...input, sources: input.sources.slice(0, 1) });
        expect(gate).toMatchObject({ outcome: 'partial_ready', plannedCount: 2,
            baselineReadyCount: 1 });
        expect(gate.items[1]).toMatchObject({ canonicalSymbol: '2317.TW',
            state: 'waiting_baseline', reason: 'baseline_receipt_missing' });
        expect(createDynamicDailyFinalGateReceipt({ plan: input.plan,
            baselineGate: gate, checkedAt: '2026-09-30T08:45:05+08:00',
            savedConfigRevision: 9, officialCalendarCurrent: true,
            simulation: true, businessSessionCurrent: true,
            connectionGeneration: 'simulation:1234567890abcdef' }).outcome)
            .toBe('partial_ready');
        expect(baselineGate({ ...input, sources: [] }).outcome).toBe('failed');
    });

    it('部分就緒的 08:35／08:45 收據可封存，但不得宣稱完整 160 或通知', async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-gate-partial-'));
        roots.push(root);
        const input = fixture(['2330', '2317']);
        await writeDynamicDailyCohortPlan(root, input.plan);
        const authority = { schemaVersion:
            INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
        current: true, isTradingDate: true, tradeDate: input.plan.tradeDate,
        previousTradeDate: input.plan.previousTradeDate,
        sourceVersions: input.plan.calendarSourceVersions,
        observedAt: '2026-09-30T08:34:50+08:00' };
        const first = await sealDynamicDailyBaselineGate({ root, ...input,
            sources: input.sources.slice(0, 1), authority,
            previousSessionFinalized: true,
            checkedAt: '2026-09-30T08:35:10+08:00' });
        expect(first).toMatchObject({ outcome: 'partial_ready',
            notificationAuthority: false, subscriptionAuthority: false });
        const gate = JSON.parse(await readFile(first.receiptPath, 'utf8'));
        expect(gate).toMatchObject({ baselineReadyCount: 1,
            exact160BaselineReady: false });
        const proof = { schemaVersion: DYNAMIC_DAILY_SESSION_PROOF_SCHEMA,
            simulation: true, businessSessionCurrent: true,
            connectionGeneration: 'simulation:1234567890abcdef',
            snapshotTradeDate: '2026-09-30',
            observedAt: '2026-09-30T08:44:55+08:00',
            secondLogin: false, secondStream: false };
        const second = await sealDynamicDailyFinalGate({ root, plan: input.plan,
            baselineGate: gate, authority, sessionProof: proof,
            savedConfigRevision: 9,
            checkedAt: '2026-09-30T08:45:05+08:00' });
        expect(second).toMatchObject({ outcome: 'partial_ready',
            activePlanPath: expect.any(String), notificationAuthority: false });
        expect(await readDynamicDailyActivePlan(root, input.plan.tradeDate))
            .toMatchObject({ baselineGate: { baselineReadyCount: 1,
                outcome: 'partial_ready' }, finalGate: { baselineReadyCount: 1,
                outcome: 'partial_ready' } });
    });

    it('08:35 後補封存、錯 revision 與開盤後 Gate 均 fail closed', () => {
        const input = fixture();
        expect(createDynamicDailyBaselineGateReceipt({ ...input,
            checkedAt: '2026-09-30T08:35:20+08:00',
            officialCalendarCurrent: true,
            previousSessionFinalized: true }).outcome).toBe('ready');
        expect(baselineGate({ ...input, sources: [{ ...input.sources[0],
            sealedAt: '2026-09-30T08:36:00+08:00' }] }).outcome).toBe('failed');
        expect(() => createDynamicDailyBaselineGateReceipt({ ...input,
            checkedAt: '2026-09-30T08:36:00+08:00' })).toThrow();
        expect(() => createDynamicDailyBaselineGateReceipt({ ...input,
            checkedAt: '2026-09-30T09:02:00+08:00' })).toThrow();
        const gate = baselineGate(input);
        expect(createDynamicDailyFinalGateReceipt({ plan: input.plan,
            baselineGate: gate, checkedAt: '2026-09-30T08:45:00+08:00',
            savedConfigRevision: 10, officialCalendarCurrent: true,
            simulation: true, businessSessionCurrent: true,
            connectionGeneration: 'simulation:1234567890abcdef' }).outcome).toBe('failed');
        expect(() => createDynamicDailyFinalGateReceipt({ plan: input.plan,
            baselineGate: gate, checkedAt: '2026-09-30T09:02:00+08:00' })).toThrow();
    });

    it('失敗與成功收據分別不可覆寫；同 hash 重試僅核對原內容', async () => {
        const input = fixture();
        const root = await mkdtemp(path.join(os.tmpdir(), 'daily-gate-'));
        roots.push(root);
        const failed = baselineGate({ ...input, sources: [] });
        const ready = baselineGate(input);
        const failedPath = (await writeDynamicDailyGateReceipt(root, failed)).path;
        const readyPath = (await writeDynamicDailyGateReceipt(root, ready)).path;
        expect(failedPath).not.toBe(readyPath);
        expect((await readFile(failedPath, 'utf8'))).toContain('"outcome":"failed"');
        expect((await writeDynamicDailyGateReceipt(root, failed)).path).toBe(failedPath);
        expect((await readFile(readyPath, 'utf8'))).toContain('"outcome":"ready"');
    });
});
