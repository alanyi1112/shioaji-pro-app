import { describe, expect, it } from 'vitest';

import { INTRADAY_MONITOR_CONFIG_SCHEMA, validateIntradayMonitorConfig }
    from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import { INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA }
    from './trading-calendar-authority.mjs';
import { createDynamicDailyCohortPlan } from './dynamic-daily-cohort-plan.mjs';
import { dynamicDailySymbolBaselineCohortHash,
    resolveDynamicDailyBaselineCoverage } from './dynamic-daily-baseline-resolver.mjs';
import { HISTORICAL_KBAR_BASELINE_CANDIDATE_SCHEMA,
    computeHistoricalKbarPayloadHash, expectedTaiwanRegularSessionMinutes,
    validateAndBuildHistoricalKbarBaseline } from './historical-kbar-repair.mjs';
import { fixtureBaseline } from './fixtures/direct-160-baseline.mjs';
import { createDailyMinuteVolumeCandidate, DAILY_KBAR_TIMESTAMP_ENCODING,
    verifyDailyMinuteVolumeBaseline } from './daily-minute-volume-baseline.mjs';
import { createDynamicDailyBaselineGateReceipt,
    validateDynamicDailyBaselineGateReceipt } from './dynamic-daily-premarket-gate.mjs';

const previousTradeDate = '2026-09-29';
const tradeDate = '2026-09-30';

function plan(codes, { target = tradeDate, previous = previousTradeDate } = {}) {
    const config = validateIntradayMonitorConfig({ schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
        revision: 9, globalThreshold: '1.5', items: codes.map((code) => ({
            contract: { security_type: 'STK', region: 'TW', exchange: 'TSE', code,
                target_code: null }, enabled: true, thresholdOverride: null, source: 'manual' })) });
    expect(config.ok).toBe(true);
    return createDynamicDailyCohortPlan({ config: config.value,
        authority: { schemaVersion: INTRADAY_MONITOR_TRADING_CALENDAR_AUTHORITY_SCHEMA,
            current: true, isTradingDate: true, tradeDate: target, previousTradeDate: previous,
            sourceVersions: ['fixture-calendar/1'], observedAt: '2026-09-29T13:35:00+08:00' },
        approval: { decision: 'go', approvedActiveLimit: 160, approvalHash: 'a'.repeat(64) },
        createdAt: '2026-09-29T13:36:00+08:00' });
}

function verifiedManifest(dailyPlan, code) {
    const symbol = `${code}.TW`;
    const minutes = expectedTaiwanRegularSessionMinutes();
    const arrays = { datetime: minutes.map((minute) =>
        `${previousTradeDate}T${minute}:00+08:00`),
    Open: minutes.map(() => 100), High: minutes.map(() => 101),
    Low: minutes.map(() => 99), Close: minutes.map(() => 100),
    Volume: minutes.map(() => 10), Amount: minutes.map(() => 1_000) };
    const raw = { schemaVersion: HISTORICAL_KBAR_BASELINE_CANDIDATE_SCHEMA,
        symbol, exchange: 'TSE', securityType: 'STK', tradeDate: previousTradeDate,
        timeZone: 'Asia/Taipei', source: 'fixture-historical-kbars',
        sourceVersion: 'fixture/1', fetchedAt: '2026-09-29T13:35:00+08:00',
        sourceUnit: 'common_lot', canonicalUnit: 'common_lot',
        volumeSemantics: 'minute_delta', closeEncoding: 'normal_13_30',
        arrays, knownZeroMinutes: [], previousClose: 99 };
    const first = { ...raw, payloadHash: computeHistoricalKbarPayloadHash(raw) };
    const secondRaw = { ...raw, fetchedAt: '2026-09-29T13:36:00+08:00' };
    const second = { ...secondRaw, payloadHash: computeHistoricalKbarPayloadHash(secondRaw) };
    const result = validateAndBuildHistoricalKbarBaseline({
        authority: { officialTradingDay: true, identityVerified: true, instrumentStatus: 'normal',
            symbol, exchange: 'TSE', securityType: 'STK', tradeDate: previousTradeDate,
            timeZone: 'Asia/Taipei', targetTradeDate: tradeDate,
            previousApplicableTradeDate: previousTradeDate, calendarVerified: true,
            calendarSource: 'fixture-calendar', calendarSourceVersion: 'fixture-calendar/1' },
        finalVolumeAuthority: { status: 'verified', sessionScope: 'regular_session',
            unit: 'common_lot', volumeCommonLot: 2_700, symbol, exchange: 'TSE',
            tradeDate: previousTradeDate, source: 'fixture-official-close',
            sourceVersion: 'fixture-close/1' },
        candidate: first, refetchCandidate: second,
        cohortHash: dynamicDailySymbolBaselineCohortHash({ tradeDate, previousTradeDate,
            canonicalSymbol: symbol, exchange: 'TSE' }),
        now: '2026-09-29T13:36:30+08:00' });
    expect(result.ok).toBe(true);
    return result.manifest;
}

function verifiedDailyV2(code, { volume = 10, target = tradeDate } = {}) {
    const symbol = `${code}.TW`;
    const minutes = expectedTaiwanRegularSessionMinutes();
    const entry = { canonicalSymbol: symbol, contractIdentity: { security_type: 'STK',
        region: 'TW', exchange: 'TSE', code, target_code: null } };
    const candidate = createDailyMinuteVolumeCandidate({ entry,
        contract: { ...entry.contractIdentity, unit: 1000,
            trading_suspended: false, update_date: previousTradeDate },
        kbars: { fetchedAt: '2026-09-29T13:35:00+08:00', data: {
            datetime: minutes.map(minute => `${previousTradeDate}T${minute}:00`),
            Open: minutes.map(() => 100), High: minutes.map(() => 101),
            Low: minutes.map(() => 99), Close: minutes.map(() => 100),
            Volume: minutes.map(() => volume), Amount: minutes.map(() => volume * 1000),
        } }, tradeDate: previousTradeDate, sourceVersion: 'fixture/1',
        timestampEncoding: DAILY_KBAR_TIMESTAMP_ENCODING });
    const result = verifyDailyMinuteVolumeBaseline({ candidate,
        authority: { officialTradingDay: true, identityVerified: true,
            instrumentStatus: 'normal', calendarVerified: true, symbol,
            exchange: 'TSE', securityType: 'STK', tradeDate: previousTradeDate,
            previousApplicableTradeDate: previousTradeDate, targetTradeDate: target,
            timeZone: 'Asia/Taipei', calendarSource: 'fixture-calendar',
            calendarSourceVersion: 'fixture-calendar/1' },
        now: '2026-09-29T13:36:00+08:00' });
    expect(result.ok).toBe(true);
    return result.manifest;
}

describe('動態每日商品基準配對', () => {
    it('盤前 Gate 接受已驗證 v2 的 fetchedAt，拒絕時間或 hash 偽造，不要求不存在的 refetchTime', () => {
        const dailyPlan = plan(['2330']);
        const manifest = verifiedDailyV2('2330');
        const coverage = resolveDynamicDailyBaselineCoverage({ plan: dailyPlan,
            dailyV2Manifests: [manifest] });
        const gate = createDynamicDailyBaselineGateReceipt({ plan: dailyPlan, coverage,
            sources: [{ manifest, sourceHash: manifest.manifestId,
                sealedAt: manifest.fetchedAt }],
            checkedAt: '2026-09-30T08:35:00+08:00',
            officialCalendarCurrent: true, previousSessionFinalized: true });
        expect(gate).toMatchObject({ outcome: 'ready', baselineReadyCount: 1 });
        expect(validateDynamicDailyBaselineGateReceipt(gate, dailyPlan)).toBe(true);
        const invalid = createDynamicDailyBaselineGateReceipt({ plan: dailyPlan, coverage,
            sources: [{ manifest, sourceHash: 'b'.repeat(64),
                sealedAt: manifest.fetchedAt }],
            checkedAt: '2026-09-30T08:35:00+08:00',
            officialCalendarCurrent: true, previousSessionFinalized: true });
        expect(invalid).toMatchObject({ outcome: 'failed', baselineReadyCount: 0 });
    });
    it('以商品鍵值比對，另一檔缺基準只隔離該檔', () => {
        const dailyPlan = plan(['2330', '2317']);
        const result = resolveDynamicDailyBaselineCoverage({ plan: dailyPlan,
            standaloneManifests: [verifiedManifest(dailyPlan, '2317')] });
        expect(result).toMatchObject({ plannedCount: 2, baselineReadyCount: 1,
            exact160BaselineReady: false });
        expect(result.items).toEqual([
            expect.objectContaining({ canonicalSymbol: '2330.TW', state: 'waiting_baseline' }),
            expect.objectContaining({ canonicalSymbol: '2317.TW', state: 'baseline_ready' }),
        ]);
    });

    it('同交易日同商品在重排後仍可重用，不能借給另一商品', () => {
        const oldPlan = plan(['2330', '2317']);
        const newPlan = plan(['2317', '2330']);
        const manifest = verifiedManifest(oldPlan, '2330');
        const result = resolveDynamicDailyBaselineCoverage({ plan: newPlan,
            standaloneManifests: [manifest] });
        expect(result.items[1]).toMatchObject({ canonicalSymbol: '2330.TW',
            state: 'baseline_ready' });
        expect(result.items[0]).toMatchObject({ canonicalSymbol: '2317.TW',
            state: 'waiting_baseline' });
        expect(() => dynamicDailySymbolBaselineCohortHash({ tradeDate,
            previousTradeDate, canonicalSymbol: '2330.TWO', exchange: 'TSE' }))
            .toThrow('symbol_baseline_identity_invalid');
    });

    it('一檔基準錯日期時只隔離該檔，不連帶關閉其他有效商品', () => {
        const dailyPlan = plan(['2330', '2317']);
        const corrupted = { ...verifiedManifest(dailyPlan, '2330'),
            tradeDate: '2026-09-24' };
        const result = resolveDynamicDailyBaselineCoverage({ plan: dailyPlan,
            standaloneManifests: [corrupted, verifiedManifest(dailyPlan, '2317')] });
        expect(result).toMatchObject({ plannedCount: 2, baselineReadyCount: 1 });
        expect(result.items[0]).toMatchObject({ state: 'waiting_baseline',
            reason: 'baseline_invalid' });
        expect(result.items[1]).toMatchObject({ state: 'baseline_ready' });
    });

    it('同檔混有錯誤來源時 fail closed，不讓合法來源掩蓋衝突', () => {
        const dailyPlan = plan(['2330', '2317']);
        const valid = verifiedManifest(dailyPlan, '2330');
        const result = resolveDynamicDailyBaselineCoverage({ plan: dailyPlan,
            standaloneManifests: [{ ...valid, tradeDate: '2026-09-24' }, valid,
                verifiedManifest(dailyPlan, '2317')] });
        expect(result).toMatchObject({ baselineReadyCount: 1 });
        expect(result.items[0]).toMatchObject({ state: 'waiting_baseline',
            reason: 'baseline_invalid' });
        expect(result.items[1]).toMatchObject({ state: 'baseline_ready' });
    });

    it('可依商品與日期引用原 Stage-160 的已驗證基準，不改寫原 manifest', () => {
        const cohortManifest = { stage: 160, manifestHash: 'a'.repeat(64),
            cohort: Array.from({ length: 160 }, (_, index) => ({
                canonicalSymbol: `${1001 + index}.TW`,
                contractIdentity: { code: String(1001 + index), exchange: 'TSE',
                    security_type: 'STK', region: 'TW' },
            })) };
        const baseline = fixtureBaseline(cohortManifest);
        const originalHash = baseline.baselineHash;
        const dailyPlan = plan(['1002', '1001'], { target: '2026-09-14', previous: '2026-09-11' });
        const result = resolveDynamicDailyBaselineCoverage({ plan: dailyPlan,
            verifiedSets: [{ cohortManifest, baseline }] });
        expect(result).toMatchObject({ plannedCount: 2, baselineReadyCount: 2,
            exact160BaselineReady: false });
        expect(baseline.baselineHash).toBe(originalHash);
    });

    it('日常模式優先選 v2，若只有合法 v1 則唯讀沿用', () => {
        const dailyPlan = plan(['2330', '2317']);
        const old = verifiedManifest(dailyPlan, '2330');
        const newer = verifiedDailyV2('2330');
        const result = resolveDynamicDailyBaselineCoverage({ plan: dailyPlan,
            standaloneManifests: [old, verifiedManifest(dailyPlan, '2317')],
            dailyV2Manifests: [newer] });
        expect(result.items[0]).toMatchObject({ state: 'baseline_ready',
            manifestId: newer.manifestId, schemaVersion: newer.schemaVersion });
        expect(result.items[1]).toMatchObject({ state: 'baseline_ready',
            manifestId: expect.any(String) });
        expect(old.provenance).toBe('historical_baseline_verified');
    });

    it('v2 與 v1 累積量衝突、來源日期錯誤或持久衝突紀錄時逐檔拒絕', () => {
        const dailyPlan = plan(['2330', '2317']);
        const old = verifiedManifest(dailyPlan, '2330');
        const mismatch = resolveDynamicDailyBaselineCoverage({ plan: dailyPlan,
            standaloneManifests: [old, verifiedManifest(dailyPlan, '2317')],
            dailyV2Manifests: [verifiedDailyV2('2330', { volume: 11 })] });
        expect(mismatch.items[0]).toMatchObject({ state: 'waiting_baseline',
            reason: 'baseline_source_conflict' });
        expect(mismatch.items[1].state).toBe('baseline_ready');
        const conflict = resolveDynamicDailyBaselineCoverage({ plan: dailyPlan,
            dailyV2Manifests: [verifiedDailyV2('2330')], conflictSymbols: ['2330.TW'] });
        expect(conflict.items[0]).toMatchObject({ state: 'waiting_baseline',
            reason: 'baseline_source_conflict' });
        const stale = resolveDynamicDailyBaselineCoverage({ plan: dailyPlan,
            dailyV2Manifests: [verifiedDailyV2('2330', { target: '2026-10-01' })] });
        expect(stale.items[0]).toMatchObject({ state: 'waiting_baseline',
            reason: 'baseline_invalid' });
    });
});
