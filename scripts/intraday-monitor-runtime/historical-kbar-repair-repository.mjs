import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { isHistoricalKbarInterruptionRecord,
    isHistoricalKbarRepairManifest } from './historical-kbar-repair.mjs';

export const HISTORICAL_KBAR_REPAIR_REPOSITORY_SCHEMA_VERSION = 2;
export const HISTORICAL_KBAR_REPAIR_DATABASE_NAME =
    'intraday-historical-kbar-repair.sqlite3';

const CREATE_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS intraday_historical_repair_meta (
    singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS intraday_historical_repair_manifests (
    manifest_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL CHECK (exchange IN ('TSE', 'OTC')),
    trade_date TEXT NOT NULL,
    source TEXT NOT NULL,
    source_version TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    repository_revision INTEGER NOT NULL CHECK (repository_revision > 0),
    manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
    created_at TEXT NOT NULL,
    UNIQUE (symbol, trade_date, repository_revision)
) STRICT;

CREATE INDEX IF NOT EXISTS intraday_historical_repair_symbol_date_idx
    ON intraday_historical_repair_manifests (symbol, trade_date, repository_revision);

CREATE INDEX IF NOT EXISTS intraday_historical_repair_source_idx
    ON intraday_historical_repair_manifests
    (symbol, trade_date, source, source_version, payload_hash);
`;

const CREATE_SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS intraday_historical_repair_interruptions (
    interruption_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    exchange TEXT NOT NULL CHECK (exchange IN ('TSE', 'OTC')),
    trade_date TEXT NOT NULL,
    stream_generation TEXT NOT NULL,
    sequence_start INTEGER NOT NULL CHECK (sequence_start >= 0),
    sequence_end INTEGER NOT NULL CHECK (sequence_end >= sequence_start),
    live_payload_hash TEXT NOT NULL,
    repository_revision INTEGER NOT NULL CHECK (repository_revision > 0),
    interruption_json TEXT NOT NULL CHECK (json_valid(interruption_json)),
    created_at TEXT NOT NULL,
    UNIQUE (symbol, trade_date, stream_generation, sequence_start, sequence_end)
) STRICT;

CREATE INDEX IF NOT EXISTS intraday_historical_repair_interruption_date_idx
    ON intraday_historical_repair_interruptions (trade_date, repository_revision);
`;

export class HistoricalKbarRepairRepositoryError extends Error {
    constructor(code, details = null) {
        super(code);
        this.name = 'HistoricalKbarRepairRepositoryError';
        this.code = code;
        this.details = details;
    }
}

export function resolveHistoricalKbarRepairDatabasePath(appSupportRoot) {
    if (typeof appSupportRoot !== 'string' || !path.isAbsolute(appSupportRoot)) {
        throw new HistoricalKbarRepairRepositoryError('invalid_application_support_root');
    }
    return path.join(
        appSupportRoot,
        'IntradayMonitor',
        HISTORICAL_KBAR_REPAIR_DATABASE_NAME,
    );
}

function parseManifest(text) {
    let value;
    try {
        value = JSON.parse(text);
    } catch {
        throw new HistoricalKbarRepairRepositoryError('corrupt_repository', {
            reason: 'invalid_manifest_json',
        });
    }
    if (!isHistoricalKbarRepairManifest(value)) {
        throw new HistoricalKbarRepairRepositoryError('corrupt_repository', {
            reason: 'invalid_manifest_schema',
        });
    }
    return value;
}

function parseInterruption(text) {
    let value;
    try {
        value = JSON.parse(text);
    } catch {
        throw new HistoricalKbarRepairRepositoryError('corrupt_repository', {
            reason: 'invalid_interruption_json',
        });
    }
    if (!isHistoricalKbarInterruptionRecord(value)) {
        throw new HistoricalKbarRepairRepositoryError('corrupt_repository', {
            reason: 'invalid_interruption_schema',
        });
    }
    return value;
}

export class HistoricalKbarRepairRepository {
    constructor(databasePath) {
        if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath)) {
            throw new HistoricalKbarRepairRepositoryError('invalid_database_path');
        }
        mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
        this.database = new DatabaseSync(databasePath);
        this.database.exec('PRAGMA journal_mode = WAL;');
        this.database.exec('PRAGMA synchronous = FULL;');
        this.migrate();
    }

    migrate() {
        const version = Number(
            this.database.prepare('PRAGMA user_version;').get().user_version,
        );
        if (version > HISTORICAL_KBAR_REPAIR_REPOSITORY_SCHEMA_VERSION) {
            throw new HistoricalKbarRepairRepositoryError(
                'unsupported_repository_version',
                { version },
            );
        }
        if (version === HISTORICAL_KBAR_REPAIR_REPOSITORY_SCHEMA_VERSION) return;
        this.database.exec('BEGIN IMMEDIATE;');
        try {
            if (version === 0) this.database.exec(CREATE_SCHEMA_V1);
            this.database.exec(CREATE_SCHEMA_V2);
            this.database
                .prepare(
                    `INSERT OR IGNORE INTO intraday_historical_repair_meta
                     (singleton_key, revision) VALUES (1, 0)`,
                )
                .run();
            this.database.exec(
                `PRAGMA user_version = ${HISTORICAL_KBAR_REPAIR_REPOSITORY_SCHEMA_VERSION};`,
            );
            this.database.exec('COMMIT;');
        } catch (error) {
            this.database.exec('ROLLBACK;');
            throw error;
        }
    }

    currentRevision() {
        const row = this.database
            .prepare(
                `SELECT revision FROM intraday_historical_repair_meta
                 WHERE singleton_key = 1`,
            )
            .get();
        if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0) {
            throw new HistoricalKbarRepairRepositoryError('corrupt_repository', {
                reason: 'invalid_revision',
            });
        }
        return row.revision;
    }

    putInterruption(interruption, expectedRevision) {
        if (!isHistoricalKbarInterruptionRecord(interruption)) {
            throw new HistoricalKbarRepairRepositoryError('invalid_interruption');
        }
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
            throw new HistoricalKbarRepairRepositoryError('invalid_expected_revision');
        }
        const serialized = JSON.stringify(interruption);
        this.database.exec('BEGIN IMMEDIATE;');
        try {
            const exact = this.database.prepare(
                `SELECT repository_revision, interruption_json
                 FROM intraday_historical_repair_interruptions
                 WHERE interruption_id = ?`,
            ).get(interruption.interruptionId);
            if (exact) {
                if (exact.interruption_json !== serialized) {
                    throw new HistoricalKbarRepairRepositoryError('interruption_id_conflict');
                }
                this.database.exec('COMMIT;');
                return { inserted: false, alreadyPresent: true,
                    revision: exact.repository_revision, interruptionId: interruption.interruptionId };
            }
            const currentRevision = this.currentRevision();
            if (currentRevision !== expectedRevision) {
                throw new HistoricalKbarRepairRepositoryError('revision_conflict', {
                    expectedRevision, currentRevision });
            }
            const logical = this.database.prepare(
                `SELECT interruption_id FROM intraday_historical_repair_interruptions
                 WHERE symbol = ? AND trade_date = ? AND stream_generation = ?
                   AND sequence_start = ? AND sequence_end = ?`,
            ).get(interruption.symbol, interruption.tradeDate, interruption.streamGeneration,
                interruption.sequenceStart, interruption.sequenceEnd);
            if (logical && logical.interruption_id !== interruption.interruptionId) {
                throw new HistoricalKbarRepairRepositoryError('interruption_evidence_conflict');
            }
            const nextRevision = currentRevision + 1;
            const advance = this.database.prepare(
                `UPDATE intraday_historical_repair_meta SET revision = ?
                 WHERE singleton_key = 1 AND revision = ?`,
            ).run(nextRevision, currentRevision);
            if (Number(advance.changes) !== 1) {
                throw new HistoricalKbarRepairRepositoryError('revision_conflict');
            }
            this.database.prepare(
                `INSERT INTO intraday_historical_repair_interruptions
                 (interruption_id, symbol, exchange, trade_date, stream_generation,
                  sequence_start, sequence_end, live_payload_hash,
                  repository_revision, interruption_json, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(interruption.interruptionId, interruption.symbol, interruption.exchange,
                interruption.tradeDate, interruption.streamGeneration, interruption.sequenceStart,
                interruption.sequenceEnd, interruption.payloadHash, nextRevision, serialized,
                new Date().toISOString());
            this.database.exec('COMMIT;');
            return { inserted: true, alreadyPresent: false, revision: nextRevision,
                interruptionId: interruption.interruptionId };
        } catch (error) {
            this.database.exec('ROLLBACK;');
            throw error;
        }
    }

    readInterruption(interruptionId) {
        const row = this.database.prepare(
            `SELECT interruption_json FROM intraday_historical_repair_interruptions
             WHERE interruption_id = ?`,
        ).get(interruptionId);
        return row ? parseInterruption(row.interruption_json) : null;
    }

    listInterruptionsForTradeDate(tradeDate) {
        return this.database.prepare(
            `SELECT interruption_json FROM intraday_historical_repair_interruptions
             WHERE trade_date = ? ORDER BY repository_revision`,
        ).all(tradeDate).map((row) => parseInterruption(row.interruption_json));
    }

    putManifest(manifest, expectedRevision) {
        if (!isHistoricalKbarRepairManifest(manifest)) {
            throw new HistoricalKbarRepairRepositoryError('invalid_manifest');
        }
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
            throw new HistoricalKbarRepairRepositoryError('invalid_expected_revision');
        }
        const serialized = JSON.stringify(manifest);
        this.database.exec('BEGIN IMMEDIATE;');
        try {
            const exact = this.database
                .prepare(
                    `SELECT repository_revision, manifest_json
                     FROM intraday_historical_repair_manifests
                     WHERE manifest_id = ?`,
                )
                .get(manifest.manifestId);
            if (exact) {
                if (exact.manifest_json !== serialized) {
                    throw new HistoricalKbarRepairRepositoryError('manifest_id_conflict');
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
                throw new HistoricalKbarRepairRepositoryError('revision_conflict', {
                    expectedRevision,
                    currentRevision,
                });
            }
            const sourceRows = this.database
                .prepare(
                    `SELECT payload_hash, manifest_id
                     FROM intraday_historical_repair_manifests
                     WHERE symbol = ? AND trade_date = ?
                       AND source = ? AND source_version = ?`,
                )
                .all(
                    manifest.symbol,
                    manifest.tradeDate,
                    manifest.source,
                    manifest.sourceVersion,
                );
            if (sourceRows.some((row) => row.payload_hash !== manifest.payloadHash)) {
                throw new HistoricalKbarRepairRepositoryError(
                    'source_payload_conflict',
                    {
                        symbol: manifest.symbol,
                        tradeDate: manifest.tradeDate,
                        source: manifest.source,
                        sourceVersion: manifest.sourceVersion,
                    },
                );
            }

            const nextRevision = currentRevision + 1;
            const advance = this.database
                .prepare(
                    `UPDATE intraday_historical_repair_meta SET revision = ?
                     WHERE singleton_key = 1 AND revision = ?`,
                )
                .run(nextRevision, currentRevision);
            if (Number(advance.changes) !== 1) {
                throw new HistoricalKbarRepairRepositoryError('revision_conflict');
            }
            this.database
                .prepare(
                    `INSERT INTO intraday_historical_repair_manifests
                     (manifest_id, symbol, exchange, trade_date, source,
                      source_version, payload_hash, repository_revision,
                      manifest_json, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    manifest.manifestId,
                    manifest.symbol,
                    manifest.exchange,
                    manifest.tradeDate,
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
        const row = this.database
            .prepare(
                `SELECT manifest_json FROM intraday_historical_repair_manifests
                 WHERE manifest_id = ?`,
            )
            .get(manifestId);
        return row ? parseManifest(row.manifest_json) : null;
    }

    latestForSymbolDate(symbol, tradeDate) {
        const row = this.database
            .prepare(
                `SELECT manifest_json FROM intraday_historical_repair_manifests
                 WHERE symbol = ? AND trade_date = ?
                 ORDER BY repository_revision DESC LIMIT 1`,
            )
            .get(symbol, tradeDate);
        return row ? parseManifest(row.manifest_json) : null;
    }

    listForTradeDate(tradeDate) {
        return this.database
            .prepare(
                `SELECT manifest_json FROM intraday_historical_repair_manifests
                 WHERE trade_date = ? ORDER BY repository_revision`,
            )
            .all(tradeDate)
            .map((row) => parseManifest(row.manifest_json));
    }

    close() {
        this.database.close();
    }
}
