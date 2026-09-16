import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import {
    HISTORICAL_KBAR_REPAIR_CANDIDATE_SCHEMA,
    HISTORICAL_KBAR_REPAIR_PROVENANCE,
    LIVE_FULL_SESSION_PROVENANCE,
    computeHistoricalKbarPayloadHash,
    createHistoricalKbarInterruptionRecord,
    expectedTaiwanRegularSessionMinutes,
    selectIntradayBaseline,
    validateAndBuildHistoricalKbarRepair,
} from './historical-kbar-repair.mjs';
import {
    HistoricalKbarRepairRepository,
    resolveHistoricalKbarRepairDatabasePath,
} from './historical-kbar-repair-repository.mjs';

const temporaryRoots = [];
const tradeDate = '2026-09-09';

function minuteRows({ delayed = false, includeNormalClose = true } = {}) {
    const minutes = expectedTaiwanRegularSessionMinutes().filter(
        (minute) => !delayed || includeNormalClose || minute !== '13:30',
    );
    const rows = minutes.map((minute, index) => ({
        datetime: `${tradeDate}T${minute}:00+08:00`,
        open: 100 + (index % 3),
        high: 102 + (index % 3),
        low: 99 + (index % 3),
        close: 101 + (index % 3),
        volume: 10,
        amount: 1_000,
    }));
    if (delayed) {
        rows.push({
            datetime: `${tradeDate}T13:33:00+08:00`,
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
        schemaVersion: HISTORICAL_KBAR_REPAIR_CANDIDATE_SCHEMA,
        symbol: '2330.TW',
        exchange: 'TSE',
        securityType: 'STK',
        tradeDate,
        timeZone: 'Asia/Taipei',
        source: 'fixture-historical-kbars',
        sourceVersion: 'fixture-source/1',
        fetchedAt: '2026-09-09T13:35:00+08:00',
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
        fetchedAt: '2026-09-09T13:36:00+08:00',
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
        tradeDate,
        timeZone: 'Asia/Taipei',
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
        tradeDate,
        source: 'fixture-official-close',
        sourceVersion: 'fixture-close/1',
        ...overrides,
    };
}

function interruption(overrides = {}) {
    return createHistoricalKbarInterruptionRecord({
        symbol: '2330.TW',
        exchange: 'TSE',
        tradeDate,
        interruptionStart: '2026-09-09T10:00:00+08:00',
        interruptionEnd: '2026-09-09T10:05:00+08:00',
        streamGeneration: 'generation_000001',
        sequenceStart: 60,
        sequenceEnd: 65,
        cohortHash: `sha256:${'a'.repeat(64)}`,
        sourceVersion: 'fixture-live/1',
        payloadHash: `sha256:${'b'.repeat(64)}`,
        reason: 'sse_disconnected',
        liveMinutes: [
            {
                minuteKey: '09:01',
                open: 100,
                high: 102,
                low: 99,
                close: 101,
                amount: 1_000,
                volumeCommonLot: 10,
            },
            { minuteKey: '09:02', volumeCommonLot: 10 },
        ],
        ...overrides,
    });
}

function validate(value = candidate(), options = {}) {
    return validateAndBuildHistoricalKbarRepair({
        authority: options.authority ?? authority(),
        finalVolumeAuthority:
            options.finalVolumeAuthority ?? finalVolumeAuthority(),
        interruption: options.interruption ?? interruption(),
        candidate: value,
        refetchCandidate: options.refetchCandidate ?? refetch(value),
        now: options.now ?? '2026-09-09T13:36:30+08:00',
    });
}

function databasePath() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'historical-kbar-repair-'));
    temporaryRoots.push(root);
    return resolveHistoricalKbarRepairDatabasePath(root);
}

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('收盤後驗證式歷史 1 分 K 回補', () => {
    it('中斷 evidence 立即標記 partial／degraded 並暫停比較與通知', () => {
        expect(interruption()).toMatchObject({
            state: 'degraded',
            partial: true,
            comparisonPaused: true,
            notificationsPaused: true,
            liveCaptureAcceptance: false,
            streamGeneration: 'generation_000001',
            sequenceStart: 60,
            sequenceEnd: 65,
        });
    });

    it('即使輸入宣稱既有 interruption schema，仍重新驗證全部欄位', () => {
        const forged = { ...interruption(), liveMinutes: [{ minuteKey: '09:01', volumeCommonLot: -1 }] };
        const result = validate(candidate(), { interruption: forged });
        expect(result.ok).toBe(false);
        expect(result.reasonCodes).toContain('invalid_interruption_evidence');
    });

    it('完整、重疊一致、總量一致及重抓穩定時逐檔升格', () => {
        const result = validate();
        expect(result.ok).toBe(true);
        expect(result.manifest).toMatchObject({
            provenance: HISTORICAL_KBAR_REPAIR_PROVENANCE,
            baselineUsable: true,
            liveCaptureAcceptance: false,
            notificationEligible: false,
            retroactiveTriggerEligible: false,
            closeMode: 'normal_or_revised_13_30',
            liveOverlap: { matched: true, mismatchCount: 0 },
            minuteCoverage: {
                expectedMinuteCount: 270,
                canonicalMinuteCount: 270,
                firstMinute: '09:01',
                lastMinute: '13:30',
            },
            finalVolumeReconciliation: {
                matched: true,
                expectedVolumeCommonLot: 2_700,
                actualVolumeCommonLot: 2_700,
            },
        });
        expect(result.manifest.cumulativeSeries).toHaveLength(270);
        expect(result.manifest.cumulativeSeries.at(-1).cumulativeVolume).toBe(2_700);
    });

    it('live／歷史重疊分鐘成交量不一致時拒絕升格', () => {
        const result = validate(candidate(), {
            interruption: interruption({
                liveMinutes: [{ minuteKey: '09:01', volumeCommonLot: 11 }],
            }),
        });
        expect(result).toMatchObject({
            ok: false,
            baselineUsable: false,
            liveCaptureAcceptance: false,
        });
        expect(result.reasonCodes).toContain('live_overlap_mismatch');
    });

    it('歷史資料缺分鐘且沒有零成交證據時拒絕升格', () => {
        const rows = minuteRows().filter(
            (row) => !row.datetime.includes('T10:00:00'),
        );
        const result = validate(candidate(rows), {
            finalVolumeAuthority: finalVolumeAuthority(2_690),
        });
        expect(result.ok).toBe(false);
        expect(result.reasonCodes).toContain('missing_minute_without_zero_proof');
    });

    it('缺分鐘但全天量對帳可證明零成交時建立 known-zero carry-forward', () => {
        const rows = minuteRows().filter(
            (row) => !row.datetime.includes('T10:00:00'),
        );
        const value = candidate(rows, { knownZeroMinutes: ['10:00'] });
        const result = validate(value, {
            finalVolumeAuthority: finalVolumeAuthority(2_690),
        });
        expect(result.ok).toBe(true);
        expect(result.manifest.minuteCoverage.knownZeroCarryForwardCount).toBe(1);
        expect(result.manifest.repairedGap.minutes).toEqual(['10:00']);
        expect(
            result.manifest.cumulativeSeries.find((row) => row.minuteKey === '10:00'),
        ).toMatchObject({ provenance: 'known_zero_carry_forward' });
    });

    it('合法 13:33 延後撮合只併入 canonical 13:30', () => {
        const rows = minuteRows({ delayed: true, includeNormalClose: false });
        const value = candidate(rows, { closeEncoding: 'delayed_13_33' });
        const result = validate(value, {
            finalVolumeAuthority: finalVolumeAuthority(2_700),
        });
        expect(result.ok).toBe(true);
        expect(result.manifest.closeMode).toBe('delayed_13_33');
        expect(result.manifest.cumulativeSeries).toHaveLength(270);
        expect(result.manifest.cumulativeSeries.at(-1)).toMatchObject({
            minuteKey: '13:30',
            provenance: 'historical_delayed_close_bridge',
        });
        expect(
            result.manifest.cumulativeSeries.some((row) => row.minuteKey === '13:33'),
        ).toBe(false);
    });

    it('延後收盤前置連續性不足時拒絕升格', () => {
        const rows = minuteRows({ delayed: true, includeNormalClose: false }).filter(
            (row) => !row.datetime.includes('T13:29:00'),
        );
        const value = candidate(rows, {
            closeEncoding: 'delayed_13_33',
            knownZeroMinutes: ['13:29'],
        });
        const result = validate(value, {
            finalVolumeAuthority: finalVolumeAuthority(2_690),
        });
        expect(result.ok).toBe(false);
        expect(result.reasonCodes).toContain('delayed_close_continuity_incomplete');
    });

    it('cumulative volume 倒退時拒絕升格', () => {
        const rows = minuteRows();
        let cumulative = 0;
        for (const row of rows) {
            cumulative += 10;
            row.volume = cumulative;
        }
        rows[100].volume = rows[99].volume - 1;
        const value = candidate(rows, { volumeSemantics: 'cumulative' });
        const result = validate(value);
        expect(result.ok).toBe(false);
        expect(result.reasonCodes).toContain('cumulative_volume_regression');
    });

    it('相同來源版本重抓 payload hash 不一致時拒絕升格', () => {
        const value = candidate();
        const changedRows = minuteRows();
        changedRows[10].volume = 11;
        changedRows[11].volume = 9;
        const changed = candidate(changedRows, {
            fetchedAt: '2026-09-09T13:36:00+08:00',
        });
        const result = validate(value, { refetchCandidate: changed });
        expect(result.ok).toBe(false);
        expect(result.reasonCodes).toContain('refetch_payload_unstable');
    });

    it.each([
        ['來源版本', candidate(undefined, { sourceVersion: '' }), authority()],
        ['單位', candidate(undefined, { sourceUnit: 'unknown' }), authority()],
        ['官方交易日', candidate(), authority({ officialTradingDay: false })],
        ['商品身分', candidate(), authority({ identityVerified: false })],
    ])('%s authority 不明時拒絕升格', (_label, value, sourceAuthority) => {
        const result = validate(value, { authority: sourceAuthority });
        expect(result.ok).toBe(false);
        expect(result.baselineUsable).toBe(false);
    });

    it('13:34:30 前禁止執行收盤後回補', () => {
        const result = validate(candidate(), {
            now: '2026-09-09T13:34:29+08:00',
        });
        expect(result.ok).toBe(false);
        expect(result.reasonCodes).toContain('session_not_finalized');
    });

    it('回補成功仍不建立中斷當天 trigger／通知或 live acceptance', () => {
        const result = validate();
        expect(result).toMatchObject({
            ok: true,
            baselineUsable: true,
            liveCaptureAcceptance: false,
            notificationEligible: false,
            retroactiveTriggerEligible: false,
            brokerWriteAuthority: false,
            productionAuthority: false,
            serviceLifecycleAuthority: false,
        });
    });

    it('正常 full-session live baseline 維持優先且不被 repair 覆寫', () => {
        const repair = validate().manifest;
        const live = {
            provenance: LIVE_FULL_SESSION_PROVENANCE,
            baselineUsable: true,
            liveCaptureAcceptance: true,
            payloadHash: `sha256:${'c'.repeat(64)}`,
        };
        const selected = selectIntradayBaseline({
            liveBaseline: live,
            repairedBaseline: repair,
        });
        expect(selected.selected).toBe('live');
        expect(selected.baseline).toBe(live);
    });
});

describe('歷史回補 immutable manifest repository', () => {
    it('repository v1 會向前遷移 interruption table 且保留既有 revision', () => {
        const target = databasePath();
        const initialized = new HistoricalKbarRepairRepository(target);
        initialized.close();
        const legacy = new DatabaseSync(target);
        legacy.exec('DROP TABLE intraday_historical_repair_interruptions; PRAGMA user_version = 1;');
        legacy.close();

        const migrated = new HistoricalKbarRepairRepository(target);
        expect(migrated.currentRevision()).toBe(0);
        expect(migrated.putInterruption(interruption(), 0)).toMatchObject({ inserted: true, revision: 1 });
        migrated.close();
    });

    it('先以 monotonic revision 保存 immutable interruption evidence', () => {
        const repository = new HistoricalKbarRepairRepository(databasePath());
        const value = interruption();
        expect(repository.putInterruption(value, 0)).toMatchObject({
            inserted: true, revision: 1, interruptionId: value.interruptionId,
        });
        expect(repository.putInterruption(value, 0)).toMatchObject({
            inserted: false, alreadyPresent: true, revision: 1,
        });
        expect(repository.readInterruption(value.interruptionId)).toEqual(value);
        expect(repository.listInterruptionsForTradeDate(tradeDate)).toEqual([value]);
        repository.close();
    });

    it('相同 generation 與 sequence window 的不同 interruption evidence 拒絕覆寫', () => {
        const repository = new HistoricalKbarRepairRepository(databasePath());
        const first = interruption();
        repository.putInterruption(first, 0);
        const conflict = interruption({ payloadHash: `sha256:${'c'.repeat(64)}` });
        expect(() => repository.putInterruption(conflict, 1)).toThrowError(
            expect.objectContaining({ code: 'interruption_evidence_conflict' }),
        );
        expect(repository.currentRevision()).toBe(1);
        repository.close();
    });

    it('使用 monotonic revision、冪等寫入與逐商品查詢', () => {
        const repository = new HistoricalKbarRepairRepository(databasePath());
        const manifest = validate().manifest;
        expect(repository.putManifest(manifest, 0)).toMatchObject({
            inserted: true,
            revision: 1,
        });
        expect(repository.putManifest(manifest, 0)).toMatchObject({
            inserted: false,
            alreadyPresent: true,
            revision: 1,
        });
        expect(repository.currentRevision()).toBe(1);
        expect(repository.readManifest(manifest.manifestId)).toEqual(manifest);
        expect(repository.latestForSymbolDate('2330.TW', tradeDate)).toEqual(manifest);
        expect(repository.listForTradeDate(tradeDate)).toEqual([manifest]);
        repository.close();
    });

    it('過時 revision 與同來源不同 payload 均 fail closed', () => {
        const repository = new HistoricalKbarRepairRepository(databasePath());
        const first = validate().manifest;
        repository.putManifest(first, 0);

        const otherRows = minuteRows();
        otherRows[20].volume = 11;
        const otherCandidate = candidate(otherRows);
        const other = validate(otherCandidate, {
            finalVolumeAuthority: finalVolumeAuthority(2_701),
        }).manifest;
        expect(() => repository.putManifest(other, 0)).toThrowError(
            expect.objectContaining({ code: 'revision_conflict' }),
        );
        expect(() => repository.putManifest(other, 1)).toThrowError(
            expect.objectContaining({ code: 'source_payload_conflict' }),
        );
        expect(repository.currentRevision()).toBe(1);
        expect(repository.listForTradeDate(tradeDate)).toHaveLength(1);
        repository.close();
    });
});
