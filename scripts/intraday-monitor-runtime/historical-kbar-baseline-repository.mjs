import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { isHistoricalKbarBaselineManifest } from './historical-kbar-repair.mjs';

export const HISTORICAL_KBAR_BASELINE_REPOSITORY_SCHEMA_VERSION = 1;
export const HISTORICAL_KBAR_BASELINE_DATABASE_NAME =
    'intraday-historical-kbar-baseline.sqlite3';

const CREATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS intraday_historical_baseline_meta (
    singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS intraday_historical_baseline_manifests (
    manifest_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL CHECK (exchange IN ('TSE', 'OTC')),
    trade_date TEXT NOT NULL,
    target_trade_date TEXT NOT NULL,
    source TEXT NOT NULL,
    source_version TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    repository_revision INTEGER NOT NULL CHECK (repository_revision > 0),
    manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
    created_at TEXT NOT NULL,
    UNIQUE (symbol, trade_date, target_trade_date, repository_revision)
) STRICT;

CREATE INDEX IF NOT EXISTS intraday_historical_baseline_symbol_date_idx
    ON intraday_historical_baseline_manifests
    (symbol, trade_date, target_trade_date, repository_revision);

CREATE INDEX IF NOT EXISTS intraday_historical_baseline_source_idx
    ON intraday_historical_baseline_manifests
    (symbol, trade_date, source, source_version, payload_hash);
`;

export class HistoricalKbarBaselineRepositoryError extends Error {
    constructor(code, details = null) {
        super(code);
        this.name = 'HistoricalKbarBaselineRepositoryError';
        this.code = code;
        this.details = details;
    }
}

export function resolveHistoricalKbarBaselineDatabasePath(appSupportRoot) {
    if (typeof appSupportRoot !== 'string' || !path.isAbsolute(appSupportRoot)) {
        throw new HistoricalKbarBaselineRepositoryError(
            'invalid_application_support_root',
        );
    }
    return path.join(
        appSupportRoot,
        'IntradayMonitor',
        HISTORICAL_KBAR_BASELINE_DATABASE_NAME,
    );
}

function parseManifest(text) {
    let value;
    try {
        value = JSON.parse(text);
    } catch {
        throw new HistoricalKbarBaselineRepositoryError('corrupt_repository', {
            reason: 'invalid_manifest_json',
        });
    }
    if (!isHistoricalKbarBaselineManifest(value)) {
        throw new HistoricalKbarBaselineRepositoryError('corrupt_repository', {
            reason: 'invalid_manifest_schema',
        });
    }
    return value;
}

export class HistoricalKbarBaselineRepository {
    constructor(databasePath) {
        if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath)) {
            throw new HistoricalKbarBaselineRepositoryError('invalid_database_path');
        }
        mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
        this.database = new DatabaseSync(databasePath);
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
        if (version > HISTORICAL_KBAR_BASELINE_REPOSITORY_SCHEMA_VERSION) {
            throw new HistoricalKbarBaselineRepositoryError(
                'unsupported_repository_version',
                { version },
            );
        }
        if (version === HISTORICAL_KBAR_BASELINE_REPOSITORY_SCHEMA_VERSION) return;
        this.database.exec('BEGIN IMMEDIATE;');
        try {
            this.database.exec(CREATE_SCHEMA);
            this.database.prepare(
                `INSERT OR IGNORE INTO intraday_historical_baseline_meta
                 (singleton_key, revision) VALUES (1, 0)`,
            ).run();
            this.database.exec(
                `PRAGMA user_version = ${HISTORICAL_KBAR_BASELINE_REPOSITORY_SCHEMA_VERSION};`,
            );
            this.database.exec('COMMIT;');
        } catch (error) {
            this.database.exec('ROLLBACK;');
            throw error;
        }
    }

    currentRevision() {
        const row = this.database.prepare(
            `SELECT revision FROM intraday_historical_baseline_meta
             WHERE singleton_key = 1`,
        ).get();
        if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0) {
            throw new HistoricalKbarBaselineRepositoryError('corrupt_repository', {
                reason: 'invalid_revision',
            });
        }
        return row.revision;
    }

    putManifest(manifest, expectedRevision) {
        if (!isHistoricalKbarBaselineManifest(manifest)) {
            throw new HistoricalKbarBaselineRepositoryError('invalid_manifest');
        }
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
            throw new HistoricalKbarBaselineRepositoryError(
                'invalid_expected_revision',
            );
        }
        const serialized = JSON.stringify(manifest);
        this.database.exec('BEGIN IMMEDIATE;');
        try {
            const exact = this.database.prepare(
                `SELECT repository_revision, manifest_json
                 FROM intraday_historical_baseline_manifests
                 WHERE manifest_id = ?`,
            ).get(manifest.manifestId);
            if (exact) {
                if (exact.manifest_json !== serialized) {
                    throw new HistoricalKbarBaselineRepositoryError(
                        'manifest_id_conflict',
                    );
                }
                this.database.exec('COMMIT;');
                return {
                    inserted: false,
                    alreadyPresent: true,
                    revision: exact.repository_revision,
                    manifestId: manifest.manifestId,
                };
            }
            const currentRevision = this.currentRevision();
            if (currentRevision !== expectedRevision) {
                throw new HistoricalKbarBaselineRepositoryError(
                    'revision_conflict',
                    { expectedRevision, currentRevision },
                );
            }
            const sourceRows = this.database.prepare(
                `SELECT payload_hash FROM intraday_historical_baseline_manifests
                 WHERE symbol = ? AND trade_date = ?
                   AND source = ? AND source_version = ?`,
            ).all(
                manifest.symbol,
                manifest.tradeDate,
                manifest.source,
                manifest.sourceVersion,
            );
            if (sourceRows.some((row) => row.payload_hash !== manifest.payloadHash)) {
                throw new HistoricalKbarBaselineRepositoryError(
                    'source_payload_conflict',
                    {
                        symbol: manifest.symbol,
                        tradeDate: manifest.tradeDate,
                        source: manifest.source,
                        sourceVersion: manifest.sourceVersion,
                    },
                );
            }
            const logical = this.database.prepare(
                `SELECT manifest_id FROM intraday_historical_baseline_manifests
                 WHERE symbol = ? AND trade_date = ? AND target_trade_date = ?`,
            ).get(manifest.symbol, manifest.tradeDate, manifest.targetTradeDate);
            if (logical && logical.manifest_id !== manifest.manifestId) {
                throw new HistoricalKbarBaselineRepositoryError(
                    'baseline_manifest_conflict',
                );
            }

            const nextRevision = currentRevision + 1;
            const advanced = this.database.prepare(
                `UPDATE intraday_historical_baseline_meta SET revision = ?
                 WHERE singleton_key = 1 AND revision = ?`,
            ).run(nextRevision, currentRevision);
            if (Number(advanced.changes) !== 1) {
                throw new HistoricalKbarBaselineRepositoryError('revision_conflict');
            }
            this.database.prepare(
                `INSERT INTO intraday_historical_baseline_manifests
                 (manifest_id, symbol, exchange, trade_date, target_trade_date,
                  source, source_version, payload_hash, repository_revision,
                  manifest_json, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(
                manifest.manifestId,
                manifest.symbol,
                manifest.exchange,
                manifest.tradeDate,
                manifest.targetTradeDate,
                manifest.source,
                manifest.sourceVersion,
                manifest.payloadHash,
                nextRevision,
                serialized,
                new Date().toISOString(),
            );
            this.database.exec('COMMIT;');
            return {
                inserted: true,
                alreadyPresent: false,
                revision: nextRevision,
                manifestId: manifest.manifestId,
            };
        } catch (error) {
            this.database.exec('ROLLBACK;');
            throw error;
        }
    }

    readManifest(manifestId) {
        const row = this.database.prepare(
            `SELECT manifest_json FROM intraday_historical_baseline_manifests
             WHERE manifest_id = ?`,
        ).get(manifestId);
        return row ? parseManifest(row.manifest_json) : null;
    }

    latestForSymbolDate(symbol, tradeDate, targetTradeDate) {
        const row = this.database.prepare(
            `SELECT manifest_json FROM intraday_historical_baseline_manifests
             WHERE symbol = ? AND trade_date = ? AND target_trade_date = ?
             ORDER BY repository_revision DESC LIMIT 1`,
        ).get(symbol, tradeDate, targetTradeDate);
        return row ? parseManifest(row.manifest_json) : null;
    }

    listForTargetTradeDate(targetTradeDate) {
        return this.database.prepare(
            `SELECT manifest_json FROM intraday_historical_baseline_manifests
             WHERE target_trade_date = ? ORDER BY repository_revision`,
        ).all(targetTradeDate).map((row) => parseManifest(row.manifest_json));
    }

    close() {
        this.database.close();
    }
}
