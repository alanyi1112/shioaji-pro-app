import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    HISTORICAL_KBAR_BASELINE_CANDIDATE_SCHEMA,
    HISTORICAL_KBAR_BASELINE_PROVENANCE,
    LIVE_FULL_SESSION_PROVENANCE,
    computeHistoricalKbarPayloadHash,
    expectedTaiwanRegularSessionMinutes,
    selectIntradayBaseline,
    validateAndBuildHistoricalKbarBaseline,
} from './historical-kbar-repair.mjs';
import {
    HistoricalKbarBaselineRepository,
    resolveHistoricalKbarBaselineDatabasePath,
} from './historical-kbar-baseline-repository.mjs';
import {
    createHistoricalKbarBaselineWorker,
    issueHistoricalKbarBaselineAuthority,
} from './historical-kbar-baseline-worker.mjs';

const temporaryRoots = [];
const previousTradeDate = '2026-09-10';
const targetTradeDate = '2026-09-11';
const cohortHash = `sha256:${'a'.repeat(64)}`;

function minuteRows({ delayed = false, includeNormalClose = true } = {}) {
    const minutes = expectedTaiwanRegularSessionMinutes().filter(
        (minute) => !delayed || includeNormalClose || minute !== '13:30',
    );
    const rows = minutes.map((minute, index) => ({
        datetime: `${previousTradeDate}T${minute}:00+08:00`,
        open: 100 + (index % 3),
        high: 102 + (index % 3),
        low: 99 + (index % 3),
        close: 101 + (index % 3),
        volume: 10,
        amount: 1_000,
    }));
    if (delayed) {
        rows.push({
            datetime: `${previousTradeDate}T13:33:00+08:00`,
            open: 101,
            high: 104,
            low: 100,
            close: 103,
            volume: 10,
            amount: 1_000,
        });
    }
    return rows;
}

function arraysFromRows(rows) {
    return {
        datetime: rows.map((row) => row.datetime),
        Open: rows.map((row) => row.open),
        High: rows.map((row) => row.high),
        Low: rows.map((row) => row.low),
        Close: rows.map((row) => row.close),
        Volume: rows.map((row) => row.volume),
        Amount: rows.map((row) => row.amount),
    };
}

function candidate(rows = minuteRows(), overrides = {}) {
    const value = {
        schemaVersion: HISTORICAL_KBAR_BASELINE_CANDIDATE_SCHEMA,
        symbol: '2330.TW',
        exchange: 'TSE',
        securityType: 'STK',
        tradeDate: previousTradeDate,
        timeZone: 'Asia/Taipei',
        source: 'fixture-historical-kbars',
        sourceVersion: 'fixture-source/1',
        fetchedAt: '2026-09-10T13:35:00+08:00',
        sourceUnit: 'common_lot',
        canonicalUnit: 'common_lot',
        volumeSemantics: 'minute_delta',
        closeEncoding: 'normal_13_30',
        arrays: arraysFromRows(rows),
        knownZeroMinutes: [],
        previousClose: 99,
        ...overrides,
    };
    return { ...value, payloadHash: computeHistoricalKbarPayloadHash(value) };
}

function refetch(value, overrides = {}) {
    const next = {
        ...value,
        fetchedAt: '2026-09-10T13:36:00+08:00',
        ...overrides,
    };
    return { ...next, payloadHash: computeHistoricalKbarPayloadHash(next) };
}

function authority(overrides = {}) {
    return {
        officialTradingDay: true,
        identityVerified: true,
        instrumentStatus: 'normal',
        symbol: '2330.TW',
        exchange: 'TSE',
        securityType: 'STK',
        tradeDate: previousTradeDate,
        timeZone: 'Asia/Taipei',
        targetTradeDate,
        previousApplicableTradeDate: previousTradeDate,
        calendarVerified: true,
        calendarSource: 'fixture-calendar',
        calendarSourceVersion: 'fixture-calendar/1',
        ...overrides,
    };
}

function finalVolumeAuthority(volumeCommonLot = 2_700, overrides = {}) {
    return {
        status: 'verified',
        sessionScope: 'regular_session',
        unit: 'common_lot',
        volumeCommonLot,
        symbol: '2330.TW',
        exchange: 'TSE',
        tradeDate: previousTradeDate,
        source: 'fixture-official-close',
        sourceVersion: 'fixture-close/1',
        ...overrides,
    };
}

function validate(value = candidate(), options = {}) {
    return validateAndBuildHistoricalKbarBaseline({
        authority: options.authority ?? authority(),
        finalVolumeAuthority:
            options.finalVolumeAuthority ?? finalVolumeAuthority(),
        candidate: value,
        refetchCandidate: options.refetchCandidate ?? refetch(value),
        cohortHash: options.cohortHash ?? cohortHash,
        now: options.now ?? '2026-09-10T13:36:30+08:00',
    });
}

function databasePath() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'historical-kbar-baseline-'));
    temporaryRoots.push(root);
    return resolveHistoricalKbarBaselineDatabasePath(root);
}

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('正常前一交易日歷史 1 分 K baseline', () => {
    it('完整雙抓、收盤總量與 270 分鐘皆一致時升格', () => {
        const result = validate();
        expect(result).toMatchObject({
            ok: true,
            baselineUsable: true,
            liveCaptureAcceptance: false,
            notificationEligible: false,
            retroactiveTriggerEligible: false,
        });
        expect(result.manifest).toMatchObject({
            provenance: HISTORICAL_KBAR_BASELINE_PROVENANCE,
            tradeDate: previousTradeDate,
            targetTradeDate,
            cohortHash,
            payloadHash: result.manifest.refetchPayloadHash,
            minuteCoverage: {
                expectedMinuteCount: 270,
                canonicalMinuteCount: 270,
            },
            finalVolumeReconciliation: {
                matched: true,
                actualVolumeCommonLot: 2_700,
            },
        });
        expect(result.manifest.cumulativeSeries.at(-1).cumulativeVolume).toBe(2_700);
    });

    it('雙抓 payload 不一致時 fail closed', () => {
        const value = candidate();
        const changedRows = minuteRows();
        changedRows[10].volume = 11;
        changedRows[11].volume = 9;
        const result = validate(value, {
            refetchCandidate: candidate(changedRows, {
                fetchedAt: '2026-09-10T13:36:00+08:00',
            }),
        });
        expect(result.ok).toBe(false);
        expect(result.reasonCodes).toContain('refetch_payload_unstable');
    });

    it('缺分鐘且無零成交證據時拒絕，對帳可證明時才 carry-forward', () => {
        const rows = minuteRows().filter(
            (row) => !row.datetime.includes('T10:00:00'),
        );
        const rejected = validate(candidate(rows), {
            finalVolumeAuthority: finalVolumeAuthority(2_690),
        });
        expect(rejected.reasonCodes).toContain('missing_minute_without_zero_proof');

        const accepted = validate(candidate(rows, { knownZeroMinutes: ['10:00'] }), {
            finalVolumeAuthority: finalVolumeAuthority(2_690),
        });
        expect(accepted.ok).toBe(true);
        expect(accepted.manifest.minuteCoverage).toMatchObject({
            knownZeroCarryForwardCount: 1,
            knownZeroMinutes: ['10:00'],
        });
    });

    it('合法 13:33 只併入 canonical 13:30', () => {
        const rows = minuteRows({ delayed: true, includeNormalClose: false });
        const result = validate(candidate(rows, {
            closeEncoding: 'delayed_13_33',
        }));
        expect(result.ok).toBe(true);
        expect(result.manifest.closeMode).toBe('delayed_13_33');
        expect(result.manifest.cumulativeSeries.at(-1).minuteKey).toBe('13:30');
        expect(result.manifest.cumulativeSeries.some(
            (row) => row.minuteKey === '13:33',
        )).toBe(false);
    });

    it('延後收盤前置不連續與 cumulative volume 倒退時拒絕', () => {
        const delayedRows = minuteRows({ delayed: true, includeNormalClose: false })
            .filter((row) => !row.datetime.includes('T13:29:00'));
        const delayed = validate(candidate(delayedRows, {
            closeEncoding: 'delayed_13_33',
            knownZeroMinutes: ['13:29'],
        }), { finalVolumeAuthority: finalVolumeAuthority(2_690) });
        expect(delayed.reasonCodes).toContain('delayed_close_continuity_incomplete');

        const cumulativeRows = minuteRows();
        let cumulative = 0;
        for (const row of cumulativeRows) {
            cumulative += 10;
            row.volume = cumulative;
        }
        cumulativeRows[100].volume = cumulativeRows[99].volume - 1;
        const regressed = validate(candidate(cumulativeRows, {
            volumeSemantics: 'cumulative',
        }));
        expect(regressed.reasonCodes).toContain('cumulative_volume_regression');
    });

    it('非緊接前日、authority 或單位不明時拒絕', () => {
        expect(validate(candidate(), {
            authority: authority({ previousApplicableTradeDate: '2026-09-09' }),
        }).reasonCodes).toContain('previous_trade_date_authority_unverified');
        expect(validate(candidate(), {
            authority: authority({ calendarVerified: false }),
        }).reasonCodes).toContain('previous_trade_date_authority_unverified');
        expect(validate(candidate(undefined, { sourceUnit: 'unknown' })).reasonCodes)
            .toContain('unknown_volume_unit');
    });

    it('開盤後不得再啟動正常歷史 baseline bootstrap', () => {
        expect(validate(candidate(), {
            now: '2026-09-11T09:01:00+08:00',
        }).reasonCodes).toContain('baseline_bootstrap_window_closed');
    });

    it('resolver 維持 live、normal historical、repair 的固定優先序', () => {
        const historical = validate().manifest;
        const live = {
            provenance: LIVE_FULL_SESSION_PROVENANCE,
            baselineUsable: true,
        };
        expect(selectIntradayBaseline({
            liveBaseline: live,
            historicalBaseline: historical,
        }).selected).toBe('live');
        expect(selectIntradayBaseline({ historicalBaseline: historical })).toMatchObject({
            selected: 'historical_baseline',
            baseline: historical,
        });
    });
});

describe('正常歷史 baseline immutable repository 與 bounded worker', () => {
    it('repository 使用 monotonic revision、冪等寫入及 source conflict detection', () => {
        const repository = new HistoricalKbarBaselineRepository(databasePath());
        const first = validate().manifest;
        expect(repository.putManifest(first, 0)).toMatchObject({
            inserted: true,
            revision: 1,
        });
        expect(repository.putManifest(first, 0)).toMatchObject({
            inserted: false,
            alreadyPresent: true,
            revision: 1,
        });
        expect(repository.latestForSymbolDate(
            '2330.TW', previousTradeDate, targetTradeDate,
        )).toEqual(first);

        const changedRows = minuteRows();
        changedRows[0].volume = 11;
        changedRows[1].volume = 9;
        const conflicting = validate(candidate(changedRows)).manifest;
        expect(() => repository.putManifest(conflicting, 1)).toThrowError(
            expect.objectContaining({ code: 'source_payload_conflict' }),
        );
        expect(repository.currentRevision()).toBe(1);
        repository.close();
    });

    it('worker 逐檔雙抓並保持所有 retroactive／交易 authority 為零', async () => {
        const repository = new HistoricalKbarBaselineRepository(databasePath());
        const value = candidate();
        const fetchHistoricalKbars = vi.fn()
            .mockResolvedValueOnce(value)
            .mockResolvedValueOnce(refetch(value));
        const now = Date.parse('2026-09-10T13:36:30+08:00');
        const worker = createHistoricalKbarBaselineWorker({
            resolveLiveBaseline: async () => null,
            resolveInstrumentAuthority: async () => authority(),
            fetchFinalVolumeAuthority: async () => finalVolumeAuthority(),
            fetchHistoricalKbars,
            repository,
            nowEpochMs: () => now,
        });
        const runAuthority = issueHistoricalKbarBaselineAuthority({
            previousTradeDate,
            targetTradeDate,
            observedAtEpochMs: now,
            timeZone: 'Asia/Taipei',
            simulation: true,
            previousSessionFinalized: true,
            calendarVerified: true,
            calendarSource: 'fixture-calendar',
            calendarSourceVersion: 'fixture-calendar/1',
            cohortHash,
        }, now);
        const result = await worker.run({
            authority: runAuthority,
            cohort: [{ symbol: '2330.TW', exchange: 'TSE' }],
        });
        expect(result).toMatchObject({
            allowed: true,
            allSucceeded: true,
            baselineUsableCount: 1,
            liveBaselineCount: 0,
            notificationDispatchCount: 0,
            retroactiveTriggerCount: 0,
            brokerWriteAttemptCount: 0,
            productionTransitionCount: 0,
            serviceLifecycleMutationCount: 0,
        });
        expect(fetchHistoricalKbars).toHaveBeenCalledTimes(2);
        repository.close();
    });

    it('已有完整 live baseline 時不呼叫歷史 provider', async () => {
        const repository = new HistoricalKbarBaselineRepository(databasePath());
        const fetchHistoricalKbars = vi.fn();
        const now = Date.parse('2026-09-10T13:36:30+08:00');
        const worker = createHistoricalKbarBaselineWorker({
            resolveLiveBaseline: async () => ({
                provenance: LIVE_FULL_SESSION_PROVENANCE,
                baselineUsable: true,
                liveCaptureAcceptance: true,
                symbol: '2330.TW',
                tradeDate: previousTradeDate,
            }),
            resolveInstrumentAuthority: vi.fn(),
            fetchFinalVolumeAuthority: vi.fn(),
            fetchHistoricalKbars,
            repository,
            nowEpochMs: () => now,
        });
        const runAuthority = issueHistoricalKbarBaselineAuthority({
            previousTradeDate,
            targetTradeDate,
            observedAtEpochMs: now,
            timeZone: 'Asia/Taipei',
            simulation: true,
            previousSessionFinalized: true,
            calendarVerified: true,
            calendarSource: 'fixture-calendar',
            calendarSourceVersion: 'fixture-calendar/1',
            cohortHash,
        }, now);
        const result = await worker.run({
            authority: runAuthority,
            cohort: [{ symbol: '2330.TW', exchange: 'TSE' }],
        });
        expect(result).toMatchObject({
            allSucceeded: true,
            baselineUsableCount: 1,
            liveBaselineCount: 1,
            results: [{ selected: 'live', liveCaptureAcceptance: true }],
        });
        expect(fetchHistoricalKbars).not.toHaveBeenCalled();
        repository.close();
    });
});
