import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import {
    INTRADAY_MONITOR_BASELINE_SCHEMA,
    INTRADAY_MONITOR_BOOTSTRAP_MANIFEST_SCHEMA,
    INTRADAY_MONITOR_OBSERVATION_SCHEMA,
    INTRADAY_MONITOR_TRIGGER_SCHEMA,
} from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import {
    IntradayMonitorEvidenceRepository,
    resolveIntradayMonitorEvidenceDatabasePath,
} from './evidence-repository.mjs';

const roots = [];

function databasePath() {
    const root = mkdtempSync(path.join(tmpdir(), 'intraday-monitor-evidence-'));
    roots.push(root);
    return resolveIntradayMonitorEvidenceDatabasePath(root);
}

function contract(code = '2330') {
    return {
        securityType: 'STK',
        region: 'TW',
        exchange: 'TSE',
        code,
        targetCode: null,
        canonicalSymbol: `${code}.TW`,
    };
}

function observation(overrides = {}) {
    return {
        schemaVersion: INTRADAY_MONITOR_OBSERVATION_SCHEMA,
        contract: contract(),
        tradeDate: '2026-09-04',
        minuteKey: '12:46',
        exchangeTime: '12:46:59.000000',
        receivedTime: '2026-09-04T12:47:00.100000+08:00',
        connectionGeneration: 'generation_000001',
        sequence: 100,
        cumulativeVolume: 3000,
        unit: 'common_lot',
        source: 'shioaji-tick-stk',
        sourceVersion: '1.7.1',
        simtrade: false,
        intradayOdd: false,
        continuity: 'complete',
        ...overrides,
    };
}

function baseline(overrides = {}) {
    return {
        schemaVersion: INTRADAY_MONITOR_BASELINE_SCHEMA,
        canonicalSymbol: '2330.TW',
        tradeDate: '2026-09-03',
        timeZone: 'Asia/Taipei',
        source: 'shioaji-kbars',
        sourceVersion: '1.7.1',
        sourceUnit: 'common_lot',
        canonicalUnit: 'common_lot',
        expectedMinuteCount: 271,
        completeness: 'complete',
        rows: [
            {
                minuteKey: '12:46',
                cumulativeVolume: 1500,
                provenance: 'observed',
            },
        ],
        payloadHash: 'a'.repeat(64),
        fetchedAt: '2026-09-04T05:00:00.000Z',
        ...overrides,
    };
}

function bootstrapManifest(overrides = {}) {
    return {
        schemaVersion: INTRADAY_MONITOR_BOOTSTRAP_MANIFEST_SCHEMA,
        kind: 'today',
        canonicalSymbol: '2330.TW',
        tradeDate: '2026-09-04',
        timeZone: 'Asia/Taipei',
        source: 'shioaji-kbars',
        sourceVersion: '1.7.1',
        sourceUnit: 'common_lot',
        canonicalUnit: 'common_lot',
        requestedMinuteStart: '09:01',
        requestedMinuteEnd: '12:46',
        actualMinuteStart: '09:01',
        actualMinuteEnd: '12:46',
        expectedMinuteCount: 226,
        actualMinuteCount: 226,
        coverageReceipt: 'verified',
        completeness: 'complete',
        monitoringEffectiveFrom: '09:01',
        earlierMinutesBackfilled: true,
        reasonCode: 'none',
        payloadHash: 'd'.repeat(64),
        fetchedAt: '2026-09-04T12:47:00+08:00',
        ...overrides,
    };
}

function trigger(overrides = {}) {
    return {
        schemaVersion: INTRADAY_MONITOR_TRIGGER_SCHEMA,
        eventId: 'event_20260904_2330_0001',
        eventHash: 'b'.repeat(64),
        kind: 'live',
        tradeDate: '2026-09-04',
        baselineTradeDate: '2026-09-03',
        canonicalSymbol: '2330.TW',
        exchange: 'TSE',
        minuteKey: '12:46',
        configRevision: 1,
        threshold: '2',
        currentCumulativeVolume: 3000,
        previousCumulativeVolume: 1500,
        unit: 'common_lot',
        sourceVersion: '1.7.1',
        formulaVersion: 'intraday-relative-volume/1',
        completeness: 'complete',
        createdAt: '2026-09-04T12:47:00.200000+08:00',
        ...overrides,
    };
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('盤中監控 evidence repository', () => {
    it('v2 migration 保存 bootstrap manifest 並可由不完整單調升級為完整', () => {
        const target = databasePath();
        mkdirSync(path.dirname(target), { recursive: true });
        const database = new DatabaseSync(target);
        database.exec(`
            CREATE TABLE intraday_monitor_evidence_meta (
                singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
                revision INTEGER NOT NULL CHECK (revision >= 0)
            ) STRICT;
            INSERT INTO intraday_monitor_evidence_meta VALUES (1, 0);
            PRAGMA user_version = 1;
        `);
        database.close();

        const repository = new IntradayMonitorEvidenceRepository(target);
        const incomplete = bootstrapManifest({
            actualMinuteEnd: '12:45',
            actualMinuteCount: 225,
            coverageReceipt: 'unavailable',
            completeness: 'incomplete',
            monitoringEffectiveFrom: '12:47',
            earlierMinutesBackfilled: false,
            reasonCode: 'coverage_unverified',
            payloadHash: 'e'.repeat(64),
        });
        expect(repository.putBootstrapManifest(incomplete, 0)).toMatchObject({
            inserted: true,
            revision: 1,
        });
        expect(repository.putBootstrapManifest(bootstrapManifest(), 1)).toMatchObject({
            replaced: true,
            revision: 2,
        });
        expect(repository.readBootstrapManifest('today', '2330.TW', '2026-09-04'))
            .toEqual(bootstrapManifest());
        repository.close();

        const migrated = new DatabaseSync(target, { readOnly: true });
        expect(migrated.prepare('PRAGMA user_version').get().user_version).toBe(2);
        migrated.close();
    });

    it('批次保存已驗證的 Kbars bootstrap observations 且整批共用單調 revision', () => {
        const repository = new IntradayMonitorEvidenceRepository(databasePath());
        const observations = [
            observation({
                minuteKey: '12:45',
                exchangeTime: '12:45:59',
                sequence: 1,
                cumulativeVolume: 2900,
                source: 'shioaji-kbars-bootstrap',
            }),
            observation({
                minuteKey: '12:46',
                exchangeTime: '12:46:59',
                sequence: 2,
                cumulativeVolume: 3000,
                source: 'shioaji-kbars-bootstrap',
            }),
        ];
        expect(repository.appendBootstrappedObservations(observations, 0)).toMatchObject({
            inserted: 2,
            revision: 1,
        });
        expect(repository.appendBootstrappedObservations(observations, 1)).toMatchObject({
            inserted: 0,
            revision: 1,
        });
        expect(repository.currentRevision()).toBe(1);
        repository.close();
    });

    it('bootstrap baseline 只允許未被引用且重疊值一致的單調完整度升級', () => {
        const repository = new IntradayMonitorEvidenceRepository(databasePath());
        const incomplete = baseline({
            completeness: 'incomplete',
            rows: [
                { minuteKey: '12:46', cumulativeVolume: 1500, provenance: 'observed' },
            ],
            payloadHash: 'f'.repeat(64),
        });
        expect(repository.putBootstrapBaseline(incomplete, 0)).toMatchObject({
            inserted: true,
            revision: 1,
        });
        const complete = baseline({
            rows: [
                { minuteKey: '12:45', cumulativeVolume: 1400, provenance: 'observed' },
                { minuteKey: '12:46', cumulativeVolume: 1500, provenance: 'observed' },
            ],
        });
        expect(repository.putBootstrapBaseline(complete, 1)).toMatchObject({
            replaced: true,
            revision: 2,
        });
        expect(() =>
            repository.putBootstrapBaseline(
                baseline({
                    rows: [
                        { minuteKey: '12:46', cumulativeVolume: 1501, provenance: 'observed' },
                    ],
                    payloadHash: '1'.repeat(64),
                }),
                2,
            ),
        ).toThrowError(expect.objectContaining({ code: 'evidence_conflict' }));
        repository.close();
    });

    it('以單調 revision 保存 baseline、minute 與具完整引用的 immutable trigger', () => {
        const target = databasePath();
        const repository = new IntradayMonitorEvidenceRepository(target);
        expect(repository.putBaseline(baseline(), 0)).toMatchObject({
            inserted: true,
            revision: 1,
        });
        expect(repository.appendObservation(observation(), 1)).toMatchObject({
            inserted: true,
            revision: 2,
        });
        expect(repository.appendTrigger(trigger(), 2)).toMatchObject({
            inserted: true,
            revision: 3,
        });
        repository.close();

        const reopened = new IntradayMonitorEvidenceRepository(target);
        expect(reopened.currentRevision()).toBe(3);
        expect(reopened.listTriggers('2026-09-04')).toEqual([trigger()]);
        expect(reopened.listTriggerResults('2026-09-04')).toEqual([{
            ...trigger(),
            currentEvidence: {
                minuteKey: '12:46',
                currentCumulativeVolume: 3000,
                previousCumulativeVolume: 1500,
                unit: 'common_lot',
                completeness: 'complete',
                sourceVersion: '1.7.1',
                baselineProvenance: 'observed',
                updatedAt: '2026-09-04T12:47:00.100000+08:00',
            },
        }]);
        reopened.close();
    });

    it('相同 payload 重播為 idempotent，不增加 revision', () => {
        const repository = new IntradayMonitorEvidenceRepository(databasePath());
        repository.putBaseline(baseline(), 0);
        expect(repository.putBaseline(baseline(), 1)).toMatchObject({
            inserted: false,
            revision: 1,
        });
        repository.appendObservation(observation(), 1);
        expect(repository.appendObservation(observation(), 2)).toMatchObject({
            inserted: false,
            revision: 2,
        });
        repository.appendTrigger(trigger(), 2);
        expect(repository.appendTrigger(trigger(), 3)).toMatchObject({
            inserted: false,
            revision: 3,
        });
        repository.close();
    });

    it('拒絕缺少引用或量不一致的 trigger，保留原 revision', () => {
        const repository = new IntradayMonitorEvidenceRepository(databasePath());
        repository.putBaseline(baseline(), 0);
        repository.appendObservation(observation(), 1);
        expect(() =>
            repository.appendTrigger(
                trigger({ currentCumulativeVolume: 3001 }),
                2,
            ),
        ).toThrowError(
            expect.objectContaining({ code: 'evidence_reference_mismatch' }),
        );
        expect(repository.currentRevision()).toBe(2);
        expect(repository.listTriggers('2026-09-04')).toEqual([]);
        repository.close();
    });

    it('同交易日、商品與 config revision 最多一個 trigger', () => {
        const repository = new IntradayMonitorEvidenceRepository(databasePath());
        repository.putBaseline(baseline(), 0);
        repository.appendObservation(observation(), 1);
        repository.appendTrigger(trigger(), 2);
        expect(() =>
            repository.appendTrigger(
                trigger({
                    eventId: 'event_20260904_2330_0002',
                    eventHash: 'c'.repeat(64),
                }),
                3,
            ),
        ).toThrowError(expect.objectContaining({ code: 'evidence_conflict' }));
        expect(repository.currentRevision()).toBe(3);
        repository.close();
    });

    it('bounded retention 保留仍由受保護當日結果引用的 evidence', () => {
        const target = databasePath();
        const repository = new IntradayMonitorEvidenceRepository(target);
        repository.putBaseline(baseline(), 0);
        repository.appendObservation(observation(), 1);
        repository.appendTrigger(trigger(), 2);

        expect(
            repository.pruneBefore({
                cutoffTradeDate: '2026-09-05',
                protectedResultTradeDates: ['2026-09-04'],
            }),
        ).toEqual({ deleted: 0, revision: 3 });
        expect(repository.listTriggers('2026-09-04')).toHaveLength(1);

        expect(
            repository.pruneBefore({
                cutoffTradeDate: '2026-09-05',
                protectedResultTradeDates: [],
            }),
        ).toMatchObject({ revision: 4 });
        expect(repository.listTriggers('2026-09-04')).toEqual([]);
        repository.close();

        const database = new DatabaseSync(target, { readOnly: true });
        for (const table of [
            'intraday_monitor_observations',
            'intraday_monitor_baselines',
            'intraday_monitor_baseline_minutes',
            'intraday_monitor_triggers',
        ]) {
            expect(
                database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
                    .count,
            ).toBe(0);
        }
        database.close();
    });

    it('revision conflict 不寫入任何 evidence', () => {
        const repository = new IntradayMonitorEvidenceRepository(databasePath());
        expect(() => repository.putBaseline(baseline(), 9)).toThrowError(
            expect.objectContaining({ code: 'revision_conflict' }),
        );
        expect(repository.currentRevision()).toBe(0);
        repository.close();
    });

    it('corrupt observation payload 在重啟後 fail closed', () => {
        const target = databasePath();
        const repository = new IntradayMonitorEvidenceRepository(target);
        repository.appendObservation(observation(), 0);
        repository.close();

        const database = new DatabaseSync(target);
        database.exec(
            `UPDATE intraday_monitor_observations SET payload_json = '{}'
             WHERE canonical_symbol = '2330.TW';`,
        );
        database.close();

        const reopened = new IntradayMonitorEvidenceRepository(target);
        expect(() => reopened.appendObservation(observation(), 1)).toThrowError(
            expect.objectContaining({ code: 'corrupt_repository' }),
        );
        expect(reopened.currentRevision()).toBe(1);
        reopened.close();
    });
});
