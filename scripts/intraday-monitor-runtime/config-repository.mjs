import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
    INTRADAY_MONITOR_CONFIG_SCHEMA,
    INTRADAY_MONITOR_DEFAULT_THRESHOLD,
    validateIntradayMonitorConfig,
} from '../../src/lib/intraday-relative-volume-monitor-domain.ts';

export const INTRADAY_MONITOR_REPOSITORY_SCHEMA_VERSION = 1;
export const INTRADAY_MONITOR_DATABASE_NAME = 'intraday-monitor.sqlite3';

const CREATE_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS intraday_monitor_config (
    singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
    schema_version TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    global_threshold TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS intraday_monitor_config_items (
    position INTEGER PRIMARY KEY CHECK (position >= 0),
    security_type TEXT NOT NULL CHECK (security_type = 'STK'),
    region TEXT NOT NULL CHECK (region = 'TW'),
    exchange TEXT NOT NULL CHECK (exchange IN ('TSE', 'OTC')),
    code TEXT NOT NULL,
    target_code TEXT CHECK (target_code IS NULL),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    threshold_override TEXT,
    source TEXT NOT NULL CHECK (source IN ('manual', 'watchlist', 'after_market_screener')),
    UNIQUE (exchange, code)
) STRICT;
`;

export class IntradayMonitorConfigRepositoryError extends Error {
    constructor(code, details = null) {
        super(code);
        this.name = 'IntradayMonitorConfigRepositoryError';
        this.code = code;
        this.details = details;
    }
}

export function resolveIntradayMonitorDatabasePath(appSupportRoot) {
    if (typeof appSupportRoot !== 'string' || !path.isAbsolute(appSupportRoot)) {
        throw new IntradayMonitorConfigRepositoryError(
            'invalid_application_support_root',
        );
    }
    return path.join(
        appSupportRoot,
        'IntradayMonitor',
        INTRADAY_MONITOR_DATABASE_NAME,
    );
}

function configDraftFromRows(configRow, itemRows) {
    return {
        schemaVersion: configRow.schema_version,
        revision: configRow.revision,
        globalThreshold: configRow.global_threshold,
        items: itemRows.map((row, index) => {
            if (row.position !== index) {
                throw new IntradayMonitorConfigRepositoryError(
                    'corrupt_repository',
                    { reason: 'non_contiguous_position' },
                );
            }
            return {
                contract: {
                    security_type: row.security_type,
                    region: row.region,
                    exchange: row.exchange,
                    code: row.code,
                    target_code: row.target_code,
                },
                enabled: row.enabled === 1,
                thresholdOverride: row.threshold_override,
                source: row.source,
            };
        }),
    };
}

export class IntradayMonitorConfigRepository {
    constructor(databasePath, { clock = () => new Date().toISOString() } = {}) {
        if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath)) {
            throw new IntradayMonitorConfigRepositoryError(
                'invalid_database_path',
            );
        }
        mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
        this.clock = clock;
        this.database = new DatabaseSync(databasePath);
        this.database.exec('PRAGMA foreign_keys = ON;');
        this.database.exec('PRAGMA journal_mode = WAL;');
        this.database.exec('PRAGMA synchronous = FULL;');
        try {
            this.migrate();
        } catch (error) {
            this.database.close();
            throw error;
        }
    }

    migrate() {
        const version = Number(
            this.database.prepare('PRAGMA user_version;').get().user_version,
        );
        if (!Number.isSafeInteger(version) || version < 0) {
            throw new IntradayMonitorConfigRepositoryError(
                'corrupt_repository',
                { reason: 'invalid_user_version' },
            );
        }
        if (version > INTRADAY_MONITOR_REPOSITORY_SCHEMA_VERSION) {
            throw new IntradayMonitorConfigRepositoryError(
                'unsupported_repository_version',
                { version },
            );
        }
        if (version === 0) {
            const now = this.clock();
            this.database.exec('BEGIN IMMEDIATE;');
            try {
                this.database.exec(CREATE_SCHEMA_V1);
                this.database
                    .prepare(
                        `INSERT OR IGNORE INTO intraday_monitor_config
                         (singleton_key, schema_version, revision, global_threshold, created_at, updated_at)
                         VALUES (1, ?, 0, ?, ?, ?)`,
                    )
                    .run(
                        INTRADAY_MONITOR_CONFIG_SCHEMA,
                        INTRADAY_MONITOR_DEFAULT_THRESHOLD,
                        now,
                        now,
                    );
                this.database.exec(
                    `PRAGMA user_version = ${INTRADAY_MONITOR_REPOSITORY_SCHEMA_VERSION};`,
                );
                this.database.exec('COMMIT;');
            } catch (error) {
                this.database.exec('ROLLBACK;');
                throw error;
            }
        }
    }

    read() {
        const configRow = this.database
            .prepare(
                `SELECT schema_version, revision, global_threshold, created_at, updated_at
                 FROM intraday_monitor_config WHERE singleton_key = 1`,
            )
            .get();
        if (!configRow) {
            throw new IntradayMonitorConfigRepositoryError(
                'corrupt_repository',
                { reason: 'missing_config' },
            );
        }
        const itemRows = this.database
            .prepare(
                `SELECT position, security_type, region, exchange, code, target_code,
                        enabled, threshold_override, source
                 FROM intraday_monitor_config_items ORDER BY position ASC`,
            )
            .all();
        const validated = validateIntradayMonitorConfig(
            configDraftFromRows(configRow, itemRows),
        );
        if (!validated.ok) {
            throw new IntradayMonitorConfigRepositoryError(
                'corrupt_repository',
                { errors: validated.errors },
            );
        }
        return validated.value;
    }

    replace(input) {
        this.database.exec('BEGIN IMMEDIATE;');
        try {
            const current = this.read();
            const validated = validateIntradayMonitorConfig(
                input,
                current.revision,
            );
            if (!validated.ok) {
                const conflict = validated.errors.some(
                    (error) => error.code === 'revision_conflict',
                );
                throw new IntradayMonitorConfigRepositoryError(
                    conflict ? 'revision_conflict' : 'invalid_config',
                    { errors: validated.errors, currentRevision: current.revision },
                );
            }

            const nextRevision = current.revision + 1;
            const now = this.clock();
            this.database
                .prepare(
                    `UPDATE intraday_monitor_config
                     SET schema_version = ?, revision = ?, global_threshold = ?, updated_at = ?
                     WHERE singleton_key = 1 AND revision = ?`,
                )
                .run(
                    INTRADAY_MONITOR_CONFIG_SCHEMA,
                    nextRevision,
                    validated.value.globalThreshold,
                    now,
                    current.revision,
                );
            this.database.exec('DELETE FROM intraday_monitor_config_items;');
            const insert = this.database.prepare(
                `INSERT INTO intraday_monitor_config_items
                 (position, security_type, region, exchange, code, target_code,
                  enabled, threshold_override, source)
                 VALUES (?, 'STK', 'TW', ?, ?, NULL, ?, ?, ?)`,
            );
            for (const item of validated.value.items) {
                insert.run(
                    item.position,
                    item.contract.exchange,
                    item.contract.code,
                    item.enabled ? 1 : 0,
                    item.thresholdOverride,
                    item.source,
                );
            }
            this.database.exec('COMMIT;');
            return this.read();
        } catch (error) {
            this.database.exec('ROLLBACK;');
            throw error;
        }
    }

    close() {
        this.database.close();
    }
}
