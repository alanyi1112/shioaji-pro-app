import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { INTRADAY_MONITOR_CONFIG_SCHEMA } from '../../src/lib/intraday-relative-volume-monitor-domain.ts';
import {
    INTRADAY_MONITOR_REPOSITORY_SCHEMA_VERSION,
    IntradayMonitorConfigRepository,
    IntradayMonitorConfigRepositoryError,
    resolveIntradayMonitorDatabasePath,
} from './config-repository.mjs';

const roots = [];

function databasePath() {
    const root = mkdtempSync(path.join(tmpdir(), 'intraday-monitor-config-'));
    roots.push(root);
    return resolveIntradayMonitorDatabasePath(root);
}

function item(code, options = {}) {
    return {
        contract: {
            security_type: 'STK',
            region: 'TW',
            exchange: options.exchange ?? 'TSE',
            code,
            target_code: null,
        },
        enabled: options.enabled ?? true,
        thresholdOverride: options.thresholdOverride ?? null,
        source: options.source ?? 'manual',
    };
}

function draft(revision, items, globalThreshold = '1.5') {
    return {
        schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
        revision,
        globalThreshold,
        items,
    };
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('盤中監控設定 repository', () => {
    it('在本機 Application Support 子目錄建立 v1 schema 與空白 revision 0', () => {
        const target = databasePath();
        const repository = new IntradayMonitorConfigRepository(target, {
            clock: () => '2026-09-04T05:30:00.000Z',
        });
        expect(repository.read()).toEqual({
            schemaVersion: INTRADAY_MONITOR_CONFIG_SCHEMA,
            revision: 0,
            globalThreshold: '1.5',
            items: [],
        });
        repository.close();

        const database = new DatabaseSync(target, { readOnly: true });
        expect(database.prepare('PRAGMA user_version;').get().user_version).toBe(
            INTRADAY_MONITOR_REPOSITORY_SCHEMA_VERSION,
        );
        database.close();
    });

    it('原子保存排序、啟用狀態、來源與有效門檻，重啟後仍可讀取', () => {
        const target = databasePath();
        let repository = new IntradayMonitorConfigRepository(target);
        const saved = repository.replace(
            draft(
                0,
                [
                    item('2454', {
                        enabled: false,
                        thresholdOverride: '3.00',
                        source: 'watchlist',
                    }),
                    item('6547', {
                        exchange: 'OTC',
                        source: 'after_market_screener',
                    }),
                ],
                '2.00',
            ),
        );
        expect(saved).toMatchObject({
            revision: 1,
            globalThreshold: '2',
            items: [
                {
                    position: 0,
                    enabled: false,
                    source: 'watchlist',
                    thresholdOverride: '3',
                    effectiveThreshold: { decimal: '3' },
                    contract: { canonicalSymbol: '2454.TW' },
                },
                {
                    position: 1,
                    enabled: true,
                    source: 'after_market_screener',
                    effectiveThreshold: { decimal: '2' },
                    contract: { canonicalSymbol: '6547.TWO' },
                },
            ],
        });
        repository.close();

        repository = new IntradayMonitorConfigRepository(target);
        expect(repository.read()).toEqual(saved);
        repository.close();
    });

    it('舊 revision、重複商品與超過 200 檔都不會部分覆寫上一版', () => {
        const target = databasePath();
        const repository = new IntradayMonitorConfigRepository(target);
        repository.replace(draft(0, [item('2330')]));
        const before = repository.read();

        expect(() => repository.replace(draft(0, [item('2454')]))).toThrowError(
            expect.objectContaining({ code: 'revision_conflict' }),
        );
        expect(() =>
            repository.replace(draft(1, [item('2330'), item('2330')])),
        ).toThrowError(expect.objectContaining({ code: 'invalid_config' }));
        expect(() =>
            repository.replace(
                draft(
                    1,
                    Array.from({ length: 201 }, (_, index) =>
                        item(String(1000 + index)),
                    ),
                ),
            ),
        ).toThrowError(expect.objectContaining({ code: 'invalid_config' }));
        expect(repository.read()).toEqual(before);
        repository.close();
    });

    it('拒絕未知的新 repository schema version 且不修改資料庫', () => {
        const target = databasePath();
        const initialized = new IntradayMonitorConfigRepository(target);
        initialized.close();
        const database = new DatabaseSync(target);
        database.exec('PRAGMA user_version = 99;');
        database.close();

        expect(
            () => new IntradayMonitorConfigRepository(target),
        ).toThrowError(
            expect.objectContaining({
                name: 'IntradayMonitorConfigRepositoryError',
                code: 'unsupported_repository_version',
            }),
        );
        expect(readFileSync(target).byteLength).toBeGreaterThan(0);
    });

    it('migration 失敗會 rollback 並維持 user_version 0', () => {
        const target = databasePath();
        mkdirSync(path.dirname(target), { recursive: true });
        const malformed = new DatabaseSync(target);
        malformed.exec(
            'CREATE TABLE intraday_monitor_config (singleton_key INTEGER PRIMARY KEY);',
        );
        malformed.close();

        expect(() => new IntradayMonitorConfigRepository(target)).toThrow();
        const inspected = new DatabaseSync(target, { readOnly: true });
        expect(inspected.prepare('PRAGMA user_version;').get().user_version).toBe(0);
        expect(
            inspected
                .prepare(
                    `SELECT COUNT(*) AS count FROM sqlite_master
                     WHERE type = 'table' AND name = 'intraday_monitor_config_items'`,
                )
                .get().count,
        ).toBe(0);
        inspected.close();
    });

    it('重啟後遇到 corrupt item row 會 fail closed', () => {
        const target = databasePath();
        const repository = new IntradayMonitorConfigRepository(target);
        repository.replace(draft(0, [item('2330')]));
        repository.close();

        const database = new DatabaseSync(target);
        database.exec(
            `UPDATE intraday_monitor_config_items SET code = 'invalid-code'
             WHERE position = 0;`,
        );
        database.close();

        const reopened = new IntradayMonitorConfigRepository(target);
        expect(() => reopened.read()).toThrowError(
            expect.objectContaining({ code: 'corrupt_repository' }),
        );
        reopened.close();
    });

    it('只接受絕對 database path', () => {
        expect(() => new IntradayMonitorConfigRepository('relative.sqlite3')).toThrow(
            IntradayMonitorConfigRepositoryError,
        );
    });
});
