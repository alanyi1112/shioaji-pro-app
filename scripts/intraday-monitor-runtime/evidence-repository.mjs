import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
    isIntradayMonitorBootstrapManifest,
    isIntradayMonitorBaseline,
    isIntradayMonitorMinuteObservation,
    isIntradayMonitorTriggerEvent,
} from '../../src/lib/intraday-relative-volume-monitor-domain.ts';

export const INTRADAY_MONITOR_EVIDENCE_SCHEMA_VERSION = 2;
export const INTRADAY_MONITOR_EVIDENCE_DATABASE_NAME =
    'intraday-monitor-evidence.sqlite3';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const CREATE_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS intraday_monitor_evidence_meta (
    singleton_key INTEGER PRIMARY KEY CHECK (singleton_key = 1),
    revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS intraday_monitor_observations (
    canonical_symbol TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    minute_key TEXT NOT NULL,
    exchange TEXT NOT NULL CHECK (exchange IN ('TSE', 'OTC')),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    cumulative_volume INTEGER NOT NULL CHECK (cumulative_volume >= 0),
    repository_revision INTEGER NOT NULL CHECK (repository_revision > 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    PRIMARY KEY (canonical_symbol, trade_date, minute_key)
) STRICT;

CREATE TABLE IF NOT EXISTS intraday_monitor_baselines (
    canonical_symbol TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    completeness TEXT NOT NULL CHECK (completeness IN ('complete', 'incomplete')),
    repository_revision INTEGER NOT NULL CHECK (repository_revision > 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    PRIMARY KEY (canonical_symbol, trade_date)
) STRICT;

CREATE TABLE IF NOT EXISTS intraday_monitor_baseline_minutes (
    canonical_symbol TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    minute_key TEXT NOT NULL,
    cumulative_volume INTEGER NOT NULL CHECK (cumulative_volume >= 0),
    provenance TEXT NOT NULL CHECK (provenance IN ('observed', 'carry_forward', 'known_zero')),
    PRIMARY KEY (canonical_symbol, trade_date, minute_key),
    FOREIGN KEY (canonical_symbol, trade_date)
        REFERENCES intraday_monitor_baselines (canonical_symbol, trade_date)
        ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS intraday_monitor_triggers (
    event_id TEXT PRIMARY KEY,
    event_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('live', 'historical')),
    trade_date TEXT NOT NULL,
    baseline_trade_date TEXT NOT NULL,
    canonical_symbol TEXT NOT NULL,
    exchange TEXT NOT NULL CHECK (exchange IN ('TSE', 'OTC')),
    minute_key TEXT NOT NULL,
    config_revision INTEGER NOT NULL CHECK (config_revision >= 0),
    repository_revision INTEGER NOT NULL CHECK (repository_revision > 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    UNIQUE (trade_date, canonical_symbol, config_revision),
    FOREIGN KEY (canonical_symbol, trade_date, minute_key)
        REFERENCES intraday_monitor_observations (canonical_symbol, trade_date, minute_key)
        ON DELETE RESTRICT,
    FOREIGN KEY (canonical_symbol, baseline_trade_date, minute_key)
        REFERENCES intraday_monitor_baseline_minutes (canonical_symbol, trade_date, minute_key)
        ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS intraday_monitor_trigger_trade_date_idx
    ON intraday_monitor_triggers (trade_date, repository_revision);
`;

const CREATE_SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS intraday_monitor_bootstrap_manifests (
    kind TEXT NOT NULL CHECK (kind IN ('baseline', 'today')),
    canonical_symbol TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    completeness TEXT NOT NULL CHECK (completeness IN ('complete', 'incomplete')),
    repository_revision INTEGER NOT NULL CHECK (repository_revision > 0),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    PRIMARY KEY (kind, canonical_symbol, trade_date)
) STRICT;

CREATE INDEX IF NOT EXISTS intraday_monitor_bootstrap_trade_date_idx
    ON intraday_monitor_bootstrap_manifests (trade_date, repository_revision);
`;

export class IntradayMonitorEvidenceRepositoryError extends Error {
    constructor(code, details = null) {
        super(code);
        this.name = 'IntradayMonitorEvidenceRepositoryError';
        this.code = code;
        this.details = details;
    }
}

export function resolveIntradayMonitorEvidenceDatabasePath(appSupportRoot) {
    if (typeof appSupportRoot !== 'string' || !path.isAbsolute(appSupportRoot)) {
        throw new IntradayMonitorEvidenceRepositoryError(
            'invalid_application_support_root',
        );
    }
    return path.join(
        appSupportRoot,
        'IntradayMonitor',
        INTRADAY_MONITOR_EVIDENCE_DATABASE_NAME,
    );
}

function parsePayload(text, validator, kind) {
    let value;
    try {
        value = JSON.parse(text);
    } catch {
        throw new IntradayMonitorEvidenceRepositoryError('corrupt_repository', {
            reason: `invalid_${kind}_json`,
        });
    }
    if (!validator(value)) {
        throw new IntradayMonitorEvidenceRepositoryError('corrupt_repository', {
            reason: `invalid_${kind}_schema`,
        });
    }
    return value;
}

function samePayload(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function sameBootstrapObservationEvidence(left, right) {
    const { receivedTime: _leftReceivedTime, ...leftEvidence } = left;
    const { receivedTime: _rightReceivedTime, ...rightEvidence } = right;
    return samePayload(leftEvidence, rightEvidence);
}

function validDate(value) {
    return (
        typeof value === 'string' &&
        ISO_DATE.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
    );
}

export class IntradayMonitorEvidenceRepository {
    constructor(databasePath) {
        if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath)) {
            throw new IntradayMonitorEvidenceRepositoryError(
                'invalid_database_path',
            );
        }
        mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
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
        if (version > INTRADAY_MONITOR_EVIDENCE_SCHEMA_VERSION) {
            throw new IntradayMonitorEvidenceRepositoryError(
                'unsupported_repository_version',
                { version },
            );
        }
        if (version === 0) {
            this.database.exec('BEGIN IMMEDIATE;');
            try {
                this.database.exec(CREATE_SCHEMA_V1);
                this.database.exec(CREATE_SCHEMA_V2);
                this.database
                    .prepare(
                        `INSERT OR IGNORE INTO intraday_monitor_evidence_meta
                         (singleton_key, revision) VALUES (1, 0)`,
                    )
                    .run();
                this.database.exec(
                    `PRAGMA user_version = ${INTRADAY_MONITOR_EVIDENCE_SCHEMA_VERSION};`,
                );
                this.database.exec('COMMIT;');
            } catch (error) {
                this.database.exec('ROLLBACK;');
                throw error;
            }
            return;
        }
        if (version === 1) {
            this.database.exec('BEGIN IMMEDIATE;');
            try {
                this.database.exec(CREATE_SCHEMA_V2);
                this.database.exec(
                    `PRAGMA user_version = ${INTRADAY_MONITOR_EVIDENCE_SCHEMA_VERSION};`,
                );
                this.database.exec('COMMIT;');
            } catch (error) {
                this.database.exec('ROLLBACK;');
                throw error;
            }
        }
    }

    currentRevision() {
        const row = this.database
            .prepare(
                `SELECT revision FROM intraday_monitor_evidence_meta
                 WHERE singleton_key = 1`,
            )
            .get();
        if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0) {
            throw new IntradayMonitorEvidenceRepositoryError(
                'corrupt_repository',
                { reason: 'invalid_revision' },
            );
        }
        return row.revision;
    }

    assertRevision(expectedRevision) {
        const currentRevision = this.currentRevision();
        if (expectedRevision !== currentRevision) {
            throw new IntradayMonitorEvidenceRepositoryError(
                'revision_conflict',
                { expectedRevision, currentRevision },
            );
        }
        return currentRevision;
    }

    advanceRevision(currentRevision) {
        const nextRevision = currentRevision + 1;
        const result = this.database
            .prepare(
                `UPDATE intraday_monitor_evidence_meta SET revision = ?
                 WHERE singleton_key = 1 AND revision = ?`,
            )
            .run(nextRevision, currentRevision);
        if (Number(result.changes) !== 1) {
            throw new IntradayMonitorEvidenceRepositoryError(
                'revision_conflict',
            );
        }
        return nextRevision;
    }

    appendObservation(observation, expectedRevision) {
        if (!isIntradayMonitorMinuteObservation(observation)) {
            throw new IntradayMonitorEvidenceRepositoryError(
                'invalid_observation',
            );
        }
        this.database.exec('BEGIN IMMEDIATE;');
        try {
            const currentRevision = this.assertRevision(expectedRevision);
            const existing = this.database
                .prepare(
                    `SELECT payload_json FROM intraday_monitor_observations
                     WHERE canonical_symbol = ? AND trade_date = ? AND minute_key = ?`,
                )
                .get(
                    observation.contract.canonicalSymbol,
                    observation.tradeDate,
                    observation.minuteKey,
                );
            if (existing) {
                const stored = parsePayload(
                    existing.payload_json,
                    isIntradayMonitorMinuteObservation,
                    'observation',
                );
                if (!samePayload(stored, observation)) {
                    throw new IntradayMonitorEvidenceRepositoryError(
                        'evidence_conflict',
                    );
                }
                this.database.exec('COMMIT;');
                return { inserted: false, revision: currentRevision, value: stored };
            }
            const nextRevision = this.advanceRevision(currentRevision);
            this.database
                .prepare(
                    `INSERT INTO intraday_monitor_observations
                     (canonical_symbol, trade_date, minute_key, exchange, sequence,
                      cumulative_volume, repository_revision, payload_json)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    observation.contract.canonicalSymbol,
                    observation.tradeDate,
                    observation.minuteKey,
                    observation.contract.exchange,
                    observation.sequence,
                    observation.cumulativeVolume,
                    nextRevision,
                    JSON.stringify(observation),
                );
            this.database.exec('COMMIT;');
            return { inserted: true, revision: nextRevision, value: observation };
        } catch (error) {
            this.database.exec('ROLLBACK;');
            throw error;
        }
    }

    appendBootstrappedObservations(observations, expectedRevision) {
        if (
            !Array.isArray(observations) ||
            observations.length < 1 ||
            observations.length > 270 ||
            observations.some(
                (observation) =>
                    !isIntradayMonitorMinuteObservation(observation) ||
                    observation.source !== 'shioaji-kbars-bootstrap' ||
                    observation.continuity !== 'complete',
            )
        ) {
            throw new IntradayMonitorEvidenceRepositoryError(
                'invalid_bootstrap_observations',
            );
        }
        const [first] = observations;
        let previousMinute = '';
        let previousSequence = 0;
        let previousVolume = -1;
        for (const observation of observations) {
            if (
                observation.contract.canonicalSymbol !==
                    first.contract.canonicalSymbol ||
                observation.tradeDate !== first.tradeDate ||
                observation.connectionGeneration !==
                    first.connectionGeneration ||
                observation.minuteKey <= previousMinute ||
                observation.sequence <= previousSequence ||
                observation.cumulativeVolume < previousVolume
            ) {
                throw new IntradayMonitorEvidenceRepositoryError(
                    'invalid_bootstrap_observations',
                );
            }
            previousMinute = observation.minuteKey;
            previousSequence = observation.sequence;
            previousVolume = observation.cumulativeVolume;
        }

        this.database.exec('BEGIN IMMEDIATE;');
        try {
            const currentRevision = this.assertRevision(expectedRevision);
            const pending = [];
            for (const observation of observations) {
                const existing = this.database
                    .prepare(
                        `SELECT payload_json FROM intraday_monitor_observations
                         WHERE canonical_symbol = ? AND trade_date = ? AND minute_key = ?`,
                    )
                    .get(
                        observation.contract.canonicalSymbol,
                        observation.tradeDate,
                        observation.minuteKey,
                    );
                if (existing) {
                    const stored = parsePayload(
                        existing.payload_json,
                        isIntradayMonitorMinuteObservation,
                        'observation',
                    );
                    if (!sameBootstrapObservationEvidence(stored, observation)) {
                        throw new IntradayMonitorEvidenceRepositoryError(
                            'evidence_conflict',
                        );
                    }
                } else {
                    pending.push(observation);
                }
            }
            if (pending.length === 0) {
                this.database.exec('COMMIT;');
                return {
                    inserted: 0,
                    revision: currentRevision,
                    values: observations,
                };
            }
            const nextRevision = this.advanceRevision(currentRevision);
            const insert = this.database.prepare(
                `INSERT INTO intraday_monitor_observations
                 (canonical_symbol, trade_date, minute_key, exchange, sequence,
                  cumulative_volume, repository_revision, payload_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            );
            for (const observation of pending) {
                insert.run(
                    observation.contract.canonicalSymbol,
                    observation.tradeDate,
                    observation.minuteKey,
                    observation.contract.exchange,
                    observation.sequence,
                    observation.cumulativeVolume,
                    nextRevision,
                    JSON.stringify(observation),
                );
            }
            this.database.exec('COMMIT;');
            return {
                inserted: pending.length,
                revision: nextRevision,
                values: observations,
            };
        } catch (error) {
            this.database.exec('ROLLBACK;');
            throw error;
        }
    }

    putBaseline(baseline, expectedRevision) {
        if (!isIntradayMonitorBaseline(baseline)) {
            throw new IntradayMonitorEvidenceRepositoryError('invalid_baseline');
        }
        this.database.exec('BEGIN IMMEDIATE;');
        try {
            const currentRevision = this.assertRevision(expectedRevision);
            const existing = this.database
                .prepare(
                    `SELECT payload_json FROM intraday_monitor_baselines
                     WHERE canonical_symbol = ? AND trade_date = ?`,
                )
                .get(baseline.canonicalSymbol, baseline.tradeDate);
            if (existing) {
                const stored = parsePayload(
                    existing.payload_json,
                    isIntradayMonitorBaseline,
                    'baseline',
                );
                if (!samePayload(stored, baseline)) {
                    throw new IntradayMonitorEvidenceRepositoryError(
                        'evidence_conflict',
                    );
                }
                this.database.exec('COMMIT;');
                return { inserted: false, revision: currentRevision, value: stored };
            }
            const nextRevision = this.advanceRevision(currentRevision);
            this.database
                .prepare(
                    `INSERT INTO intraday_monitor_baselines
                     (canonical_symbol, trade_date, payload_hash, completeness,
                      repository_revision, payload_json)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    baseline.canonicalSymbol,
                    baseline.tradeDate,
                    baseline.payloadHash,
                    baseline.completeness,
                    nextRevision,
                    JSON.stringify(baseline),
                );
            const insertMinute = this.database.prepare(
                `INSERT INTO intraday_monitor_baseline_minutes
                 (canonical_symbol, trade_date, minute_key, cumulative_volume, provenance)
                 VALUES (?, ?, ?, ?, ?)`,
            );
            for (const row of baseline.rows) {
                insertMinute.run(
                    baseline.canonicalSymbol,
                    baseline.tradeDate,
                    row.minuteKey,
                    row.cumulativeVolume,
                    row.provenance,
                );
            }
            this.database.exec('COMMIT;');
            return { inserted: true, revision: nextRevision, value: baseline };
        } catch (error) {
            this.database.exec('ROLLBACK;');
            throw error;
        }
    }

    putBootstrapBaseline(baseline, expectedRevision) {
        if (!isIntradayMonitorBaseline(baseline)) {
            throw new IntradayMonitorEvidenceRepositoryError('invalid_baseline');
        }
        this.database.exec('BEGIN IMMEDIATE;');
        try {
            const currentRevision = this.assertRevision(expectedRevision);
            const existingRow = this.database
                .prepare(
                    `SELECT payload_json FROM intraday_monitor_baselines
                     WHERE canonical_symbol = ? AND trade_date = ?`,
                )
                .get(baseline.canonicalSymbol, baseline.tradeDate);
            if (!existingRow) {
                const nextRevision = this.advanceRevision(currentRevision);
                this.insertBaselineRows(baseline, nextRevision);
                this.database.exec('COMMIT;');
                return { inserted: true, replaced: false, revision: nextRevision, value: baseline };
            }
            const existing = parsePayload(
                existingRow.payload_json,
                isIntradayMonitorBaseline,
                'baseline',
            );
            if (
                samePayload(existing, baseline) ||
                existing.payloadHash === baseline.payloadHash
            ) {
                this.database.exec('COMMIT;');
                return { inserted: false, replaced: false, revision: currentRevision, value: existing };
            }
            const existingByMinute = new Map(
                existing.rows.map((row) => [row.minuteKey, row]),
            );
            const incomingByMinute = new Map(
                baseline.rows.map((row) => [row.minuteKey, row]),
            );
            const overlapChanged = [...existingByMinute].some(
                ([minuteKey, row]) =>
                    incomingByMinute.has(minuteKey) &&
                    !samePayload(row, incomingByMinute.get(minuteKey)),
            );
            const improvesCompleteness =
                existing.completeness === 'incomplete' &&
                baseline.completeness === 'complete';
            const improvesCoverage =
                existing.completeness === 'incomplete' &&
                baseline.completeness === 'incomplete' &&
                baseline.rows.length > existing.rows.length;
            const referenced = this.database
                .prepare(
                    `SELECT 1 AS found FROM intraday_monitor_triggers
                     WHERE canonical_symbol = ? AND baseline_trade_date = ? LIMIT 1`,
                )
                .get(baseline.canonicalSymbol, baseline.tradeDate);
            if (
                referenced ||
                overlapChanged ||
                (!improvesCompleteness && !improvesCoverage)
            ) {
                throw new IntradayMonitorEvidenceRepositoryError(
                    'evidence_conflict',
                );
            }
            const nextRevision = this.advanceRevision(currentRevision);
            this.database
                .prepare(
                    `DELETE FROM intraday_monitor_baseline_minutes
                     WHERE canonical_symbol = ? AND trade_date = ?`,
                )
                .run(baseline.canonicalSymbol, baseline.tradeDate);
            this.database
                .prepare(
                    `DELETE FROM intraday_monitor_baselines
                     WHERE canonical_symbol = ? AND trade_date = ?`,
                )
                .run(baseline.canonicalSymbol, baseline.tradeDate);
            this.insertBaselineRows(baseline, nextRevision);
            this.database.exec('COMMIT;');
            return { inserted: false, replaced: true, revision: nextRevision, value: baseline };
        } catch (error) {
            this.database.exec('ROLLBACK;');
            throw error;
        }
    }

    insertBaselineRows(baseline, repositoryRevision) {
        this.database
            .prepare(
                `INSERT INTO intraday_monitor_baselines
                 (canonical_symbol, trade_date, payload_hash, completeness,
                  repository_revision, payload_json)
                 VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
                baseline.canonicalSymbol,
                baseline.tradeDate,
                baseline.payloadHash,
                baseline.completeness,
                repositoryRevision,
                JSON.stringify(baseline),
            );
        const insertMinute = this.database.prepare(
            `INSERT INTO intraday_monitor_baseline_minutes
             (canonical_symbol, trade_date, minute_key, cumulative_volume, provenance)
             VALUES (?, ?, ?, ?, ?)`,
        );
        for (const row of baseline.rows) {
            insertMinute.run(
                baseline.canonicalSymbol,
                baseline.tradeDate,
                row.minuteKey,
                row.cumulativeVolume,
                row.provenance,
            );
        }
    }

    putBootstrapManifest(manifest, expectedRevision) {
        if (!isIntradayMonitorBootstrapManifest(manifest)) {
            throw new IntradayMonitorEvidenceRepositoryError(
                'invalid_bootstrap_manifest',
            );
        }
        this.database.exec('BEGIN IMMEDIATE;');
        try {
            const currentRevision = this.assertRevision(expectedRevision);
            const existingRow = this.database
                .prepare(
                    `SELECT payload_json FROM intraday_monitor_bootstrap_manifests
                     WHERE kind = ? AND canonical_symbol = ? AND trade_date = ?`,
                )
                .get(manifest.kind, manifest.canonicalSymbol, manifest.tradeDate);
            if (existingRow) {
                const existing = parsePayload(
                    existingRow.payload_json,
                    isIntradayMonitorBootstrapManifest,
                    'bootstrap_manifest',
                );
                if (
                    samePayload(existing, manifest) ||
                    existing.payloadHash === manifest.payloadHash
                ) {
                    this.database.exec('COMMIT;');
                    return { inserted: false, replaced: false, revision: currentRevision, value: existing };
                }
                const improves =
                    existing.completeness === 'incomplete' &&
                    (manifest.completeness === 'complete' ||
                        manifest.actualMinuteCount > existing.actualMinuteCount);
                if (!improves) {
                    throw new IntradayMonitorEvidenceRepositoryError(
                        'evidence_conflict',
                    );
                }
            }
            const nextRevision = this.advanceRevision(currentRevision);
            this.database
                .prepare(
                    `INSERT INTO intraday_monitor_bootstrap_manifests
                     (kind, canonical_symbol, trade_date, completeness,
                      repository_revision, payload_json)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT(kind, canonical_symbol, trade_date) DO UPDATE SET
                       completeness = excluded.completeness,
                       repository_revision = excluded.repository_revision,
                       payload_json = excluded.payload_json`,
                )
                .run(
                    manifest.kind,
                    manifest.canonicalSymbol,
                    manifest.tradeDate,
                    manifest.completeness,
                    nextRevision,
                    JSON.stringify(manifest),
                );
            this.database.exec('COMMIT;');
            return {
                inserted: !existingRow,
                replaced: Boolean(existingRow),
                revision: nextRevision,
                value: manifest,
            };
        } catch (error) {
            this.database.exec('ROLLBACK;');
            throw error;
        }
    }

    readBootstrapManifest(kind, canonicalSymbol, tradeDate) {
        if (
            !['baseline', 'today'].includes(kind) ||
            typeof canonicalSymbol !== 'string' ||
            !/^\d{4,6}[A-Z]?\.(?:TW|TWO)$/.test(canonicalSymbol) ||
            !validDate(tradeDate)
        ) {
            throw new IntradayMonitorEvidenceRepositoryError(
                'invalid_bootstrap_manifest_key',
            );
        }
        const row = this.database
            .prepare(
                `SELECT payload_json FROM intraday_monitor_bootstrap_manifests
                 WHERE kind = ? AND canonical_symbol = ? AND trade_date = ?`,
            )
            .get(kind, canonicalSymbol, tradeDate);
        return row
            ? parsePayload(
                  row.payload_json,
                  isIntradayMonitorBootstrapManifest,
                  'bootstrap_manifest',
              )
            : null;
    }

    appendTrigger(trigger, expectedRevision) {
        if (!isIntradayMonitorTriggerEvent(trigger)) {
            throw new IntradayMonitorEvidenceRepositoryError('invalid_trigger');
        }
        this.database.exec('BEGIN IMMEDIATE;');
        try {
            const currentRevision = this.assertRevision(expectedRevision);
            const existing = this.database
                .prepare(
                    `SELECT payload_json FROM intraday_monitor_triggers
                     WHERE event_id = ?`,
                )
                .get(trigger.eventId);
            if (existing) {
                const stored = parsePayload(
                    existing.payload_json,
                    isIntradayMonitorTriggerEvent,
                    'trigger',
                );
                if (!samePayload(stored, trigger)) {
                    throw new IntradayMonitorEvidenceRepositoryError(
                        'evidence_conflict',
                    );
                }
                this.database.exec('COMMIT;');
                return { inserted: false, revision: currentRevision, value: stored };
            }

            const observation = this.database
                .prepare(
                    `SELECT cumulative_volume, exchange
                     FROM intraday_monitor_observations
                     WHERE canonical_symbol = ? AND trade_date = ? AND minute_key = ?`,
                )
                .get(
                    trigger.canonicalSymbol,
                    trigger.tradeDate,
                    trigger.minuteKey,
                );
            const baseline = this.database
                .prepare(
                    `SELECT cumulative_volume
                     FROM intraday_monitor_baseline_minutes
                     WHERE canonical_symbol = ? AND trade_date = ? AND minute_key = ?`,
                )
                .get(
                    trigger.canonicalSymbol,
                    trigger.baselineTradeDate,
                    trigger.minuteKey,
                );
            if (
                !observation ||
                !baseline ||
                observation.exchange !== trigger.exchange ||
                observation.cumulative_volume !==
                    trigger.currentCumulativeVolume ||
                baseline.cumulative_volume !== trigger.previousCumulativeVolume
            ) {
                throw new IntradayMonitorEvidenceRepositoryError(
                    'evidence_reference_mismatch',
                );
            }

            const nextRevision = this.advanceRevision(currentRevision);
            this.database
                .prepare(
                    `INSERT INTO intraday_monitor_triggers
                     (event_id, event_hash, kind, trade_date, baseline_trade_date,
                      canonical_symbol, exchange, minute_key, config_revision,
                      repository_revision, payload_json)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    trigger.eventId,
                    trigger.eventHash,
                    trigger.kind,
                    trigger.tradeDate,
                    trigger.baselineTradeDate,
                    trigger.canonicalSymbol,
                    trigger.exchange,
                    trigger.minuteKey,
                    trigger.configRevision,
                    nextRevision,
                    JSON.stringify(trigger),
                );
            this.database.exec('COMMIT;');
            return { inserted: true, revision: nextRevision, value: trigger };
        } catch (error) {
            this.database.exec('ROLLBACK;');
            if (
                error?.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE' ||
                error?.code === 'ERR_SQLITE_CONSTRAINT_FOREIGNKEY' ||
                Number(error?.errcode) % 256 === 19
            ) {
                throw new IntradayMonitorEvidenceRepositoryError(
                    'evidence_conflict',
                );
            }
            throw error;
        }
    }

    listTriggers(tradeDate) {
        if (!validDate(tradeDate)) {
            throw new IntradayMonitorEvidenceRepositoryError(
                'invalid_trade_date',
            );
        }
        return this.database
            .prepare(
                `SELECT payload_json FROM intraday_monitor_triggers
                 WHERE trade_date = ? ORDER BY repository_revision ASC`,
            )
            .all(tradeDate)
            .map((row) =>
                parsePayload(
                    row.payload_json,
                    isIntradayMonitorTriggerEvent,
                    'trigger',
                ),
            );
    }

    listTriggerResults(tradeDate) {
        return this.listTriggers(tradeDate).map((trigger) => {
            const observationRow = this.database
                .prepare(
                    `SELECT payload_json FROM intraday_monitor_observations
                     WHERE canonical_symbol = ? AND trade_date = ?
                     ORDER BY minute_key DESC LIMIT 1`,
                )
                .get(trigger.canonicalSymbol, tradeDate);
            if (!observationRow) return { ...trigger, currentEvidence: null };
            const observation = parsePayload(
                observationRow.payload_json,
                isIntradayMonitorMinuteObservation,
                'observation',
            );
            const baselineRow = this.database
                .prepare(
                    `SELECT payload_json FROM intraday_monitor_baselines
                     WHERE canonical_symbol = ? AND trade_date = ?`,
                )
                .get(trigger.canonicalSymbol, trigger.baselineTradeDate);
            const baseline = baselineRow
                ? parsePayload(baselineRow.payload_json, isIntradayMonitorBaseline, 'baseline')
                : null;
            const minute = this.database
                .prepare(
                    `SELECT cumulative_volume, provenance
                     FROM intraday_monitor_baseline_minutes
                     WHERE canonical_symbol = ? AND trade_date = ? AND minute_key = ?`,
                )
                .get(trigger.canonicalSymbol, trigger.baselineTradeDate, observation.minuteKey);
            const complete = baseline?.completeness === 'complete' && Boolean(minute);
            return {
                ...trigger,
                currentEvidence: {
                    minuteKey: observation.minuteKey,
                    currentCumulativeVolume: observation.cumulativeVolume,
                    previousCumulativeVolume: complete ? minute.cumulative_volume : null,
                    unit: 'common_lot',
                    completeness: complete ? 'complete' : 'incomplete',
                    sourceVersion: observation.sourceVersion,
                    baselineProvenance: complete ? minute.provenance : null,
                    updatedAt: observation.receivedTime,
                },
            };
        });
    }

    pruneBefore({ cutoffTradeDate, protectedResultTradeDates = [] }) {
        if (
            !validDate(cutoffTradeDate) ||
            !Array.isArray(protectedResultTradeDates) ||
            !protectedResultTradeDates.every(validDate)
        ) {
            throw new IntradayMonitorEvidenceRepositoryError(
                'invalid_retention_request',
            );
        }
        const protectedDates = [...new Set(protectedResultTradeDates)];
        const placeholders = protectedDates.map(() => '?').join(', ');
        const protectedClause = protectedDates.length
            ? `AND trade_date NOT IN (${placeholders})`
            : '';

        this.database.exec('BEGIN IMMEDIATE;');
        try {
            const currentRevision = this.currentRevision();
            const triggerResult = this.database
                .prepare(
                    `DELETE FROM intraday_monitor_triggers
                     WHERE trade_date < ? ${protectedClause}`,
                )
                .run(cutoffTradeDate, ...protectedDates);
            const observationResult = this.database
                .prepare(
                    `DELETE FROM intraday_monitor_observations AS observation
                     WHERE observation.trade_date < ?
                       AND NOT EXISTS (
                           SELECT 1 FROM intraday_monitor_triggers AS trigger
                           WHERE trigger.canonical_symbol = observation.canonical_symbol
                             AND trigger.trade_date = observation.trade_date
                             AND trigger.minute_key = observation.minute_key
                       )`,
                )
                .run(cutoffTradeDate);
            const baselineResult = this.database
                .prepare(
                    `DELETE FROM intraday_monitor_baseline_minutes AS minute
                     WHERE minute.trade_date < ?
                       AND NOT EXISTS (
                           SELECT 1 FROM intraday_monitor_triggers AS trigger
                           WHERE trigger.canonical_symbol = minute.canonical_symbol
                             AND trigger.baseline_trade_date = minute.trade_date
                             AND trigger.minute_key = minute.minute_key
                       )`,
                )
                .run(cutoffTradeDate);
            const manifestResult = this.database
                .prepare(
                    `DELETE FROM intraday_monitor_bootstrap_manifests
                     WHERE trade_date < ?`,
                )
                .run(cutoffTradeDate);
            this.database
                .prepare(
                    `DELETE FROM intraday_monitor_baselines AS baseline
                     WHERE baseline.trade_date < ?
                       AND NOT EXISTS (
                           SELECT 1 FROM intraday_monitor_baseline_minutes AS minute
                           WHERE minute.canonical_symbol = baseline.canonical_symbol
                             AND minute.trade_date = baseline.trade_date
                       )`,
                )
                .run(cutoffTradeDate);
            const deleted =
                Number(triggerResult.changes) +
                Number(observationResult.changes) +
                Number(baselineResult.changes) +
                Number(manifestResult.changes);
            const revision =
                deleted > 0
                    ? this.advanceRevision(currentRevision)
                    : currentRevision;
            this.database.exec('COMMIT;');
            return { deleted, revision };
        } catch (error) {
            this.database.exec('ROLLBACK;');
            throw error;
        }
    }

    close() {
        this.database.close();
    }
}
