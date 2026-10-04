import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
    INTRADAY_MONITOR_CONFIG_SCHEMA,
    INTRADAY_MONITOR_DEFAULT_THRESHOLD,
    validateIntradayMonitorConfig,
} from '../../src/lib/intraday-relative-volume-monitor-domain.ts';

export const INTRADAY_MONITOR_REPOSITORY_SCHEMA_VERSION = 2;
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

const CREATE_SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS intraday_monitor_config_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('ui', 'local_api', 'maintenance', 'unknown')),
    correlation_id TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN
        ('applied', 'revision_conflict', 'invalid_config', 'legacy_state_observed')),
    previous_revision INTEGER NOT NULL CHECK (previous_revision >= 0),
    requested_revision INTEGER,
    next_revision INTEGER,
    previous_hash TEXT NOT NULL,
    next_hash TEXT,
    diff_json TEXT NOT NULL
) STRICT;
CREATE TRIGGER IF NOT EXISTS intraday_monitor_config_audit_no_update
BEFORE UPDATE ON intraday_monitor_config_audit BEGIN
    SELECT RAISE(ABORT, 'config_audit_append_only');
END;
CREATE TRIGGER IF NOT EXISTS intraday_monitor_config_audit_no_delete
BEFORE DELETE ON intraday_monitor_config_audit BEGIN
    SELECT RAISE(ABORT, 'config_audit_append_only');
END;
`;

const AUDIT_SOURCE_TYPES = new Set(['ui', 'local_api', 'maintenance', 'unknown']);

function auditConfigHash(config) {
    const body = { revision: config.revision, globalThreshold: config.globalThreshold,
        items: config.items.map((item) => ({ symbol: item.contract.canonicalSymbol,
            enabled: item.enabled, thresholdOverride: item.thresholdOverride, source: item.source })) };
    return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function auditDiff(previous, next) {
    const before = new Map(previous.items.map((item) => [item.contract.canonicalSymbol, item]));
    const after = new Map(next.items.map((item) => [item.contract.canonicalSymbol, item]));
    return {
        added: next.items.filter((item) => !before.has(item.contract.canonicalSymbol))
            .map((item) => item.contract.canonicalSymbol),
        removed: previous.items.filter((item) => !after.has(item.contract.canonicalSymbol))
            .map((item) => item.contract.canonicalSymbol),
        enabledChanged: next.items.filter((item) => before.has(item.contract.canonicalSymbol) &&
            before.get(item.contract.canonicalSymbol).enabled !== item.enabled)
            .map((item) => item.contract.canonicalSymbol),
        reordered: next.items.filter((item) => before.has(item.contract.canonicalSymbol) &&
            before.get(item.contract.canonicalSymbol).position !== item.position)
            .map((item) => item.contract.canonicalSymbol),
        thresholdChanged: next.items.filter((item) => before.has(item.contract.canonicalSymbol) &&
            before.get(item.contract.canonicalSymbol).thresholdOverride !== item.thresholdOverride)
            .map((item) => item.contract.canonicalSymbol),
        globalThresholdChanged: previous.globalThreshold !== next.globalThreshold,
    };
}

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
                this.database.exec('PRAGMA user_version = 1;');
                this.database.exec('COMMIT;');
            } catch (error) {
                this.database.exec('ROLLBACK;');
                throw error;
            }
        }
        if (version <= 1) {
            this.database.exec('BEGIN IMMEDIATE;');
            try {
                this.database.exec(CREATE_SCHEMA_V2);
                const observed = this.read();
                this.insertAudit({ recordedAt: this.clock(), sourceType: 'unknown',
                    correlationId: randomUUID(), outcome: 'legacy_state_observed',
                    previousRevision: observed.revision, requestedRevision: null,
                    nextRevision: null, previousHash: auditConfigHash(observed),
                    nextHash: null, diff: {} });
                this.database.exec('PRAGMA user_version = 2;');
                this.database.exec('COMMIT;');
            } catch (error) {
                this.database.exec('ROLLBACK;');
                throw error;
            }
        }
    }

    insertAudit({ recordedAt, sourceType, correlationId, outcome, previousRevision,
        requestedRevision, nextRevision, previousHash, nextHash, diff }) {
        this.database.prepare(
            `INSERT INTO intraday_monitor_config_audit
             (recorded_at, source_type, correlation_id, outcome, previous_revision,
              requested_revision, next_revision, previous_hash, next_hash, diff_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(recordedAt, sourceType, correlationId, outcome, previousRevision,
            requestedRevision, nextRevision, previousHash, nextHash, JSON.stringify(diff));
    }

    readAudit({ limit = 100 } = {}) {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
            throw new IntradayMonitorConfigRepositoryError('invalid_audit_limit');
        }
        return this.database.prepare(
            `SELECT id, recorded_at, source_type, correlation_id, outcome,
                    previous_revision, requested_revision, next_revision,
                    previous_hash, next_hash, diff_json
             FROM intraday_monitor_config_audit ORDER BY id DESC LIMIT ?`,
        ).all(limit).map((row) => Object.freeze({ id: row.id, recordedAt: row.recorded_at,
            sourceType: row.source_type, correlationId: row.correlation_id,
            outcome: row.outcome, previousRevision: row.previous_revision,
            requestedRevision: row.requested_revision, nextRevision: row.next_revision,
            previousHash: row.previous_hash, nextHash: row.next_hash,
            diff: JSON.parse(row.diff_json) }));
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

    replace(input, { sourceType = 'unknown', correlationId = randomUUID() } = {}) {
        if (!AUDIT_SOURCE_TYPES.has(sourceType) ||
            typeof correlationId !== 'string' ||
            !/^[A-Za-z0-9_-]{16,128}$/.test(correlationId)) {
            throw new IntradayMonitorConfigRepositoryError('invalid_audit_context');
        }
        let current = null;
        this.database.exec('BEGIN IMMEDIATE;');
        try {
            current = this.read();
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
            const update = this.database
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
            if (update.changes !== 1) {
                throw new IntradayMonitorConfigRepositoryError('revision_conflict',
                    { currentRevision: current.revision });
            }
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
            const next = this.read();
            this.insertAudit({ recordedAt: now, sourceType, correlationId,
                outcome: 'applied', previousRevision: current.revision,
                requestedRevision: input?.revision ?? null,
                nextRevision: next.revision, previousHash: auditConfigHash(current),
                nextHash: auditConfigHash(next), diff: auditDiff(current, next) });
            this.database.exec('COMMIT;');
            return next;
        } catch (error) {
            this.database.exec('ROLLBACK;');
            if (current && ['revision_conflict', 'invalid_config'].includes(error?.code)) {
                try {
                    this.database.exec('BEGIN IMMEDIATE;');
                    this.insertAudit({ recordedAt: this.clock(), sourceType, correlationId,
                        outcome: error.code, previousRevision: current.revision,
                        requestedRevision: Number.isSafeInteger(input?.revision) &&
                            input.revision >= 0 ? input.revision : null,
                        nextRevision: null, previousHash: auditConfigHash(current),
                        nextHash: null, diff: {} });
                    this.database.exec('COMMIT;');
                } catch {
                    this.database.exec('ROLLBACK;');
                    throw new IntradayMonitorConfigRepositoryError('audit_unavailable');
                }
            }
            throw error;
        }
    }

    close() {
        this.database.close();
    }
}
