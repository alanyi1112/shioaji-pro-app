import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDailyMinuteVolumeBaseline } from './daily-minute-volume-baseline.mjs';

// 新資料庫，不修改 v1 baseline repository 或既有 receipt。
export class DailyMinuteVolumeRepository {
    constructor(databasePath) {
        if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath)) {
            throw new TypeError('daily_baseline_database_path_invalid');
        }
        mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
        this.database = new DatabaseSync(databasePath);
        try {
            const version = this.database.prepare('PRAGMA user_version').get().user_version;
            if (version > 1) throw new Error('daily_baseline_repository_version_unsupported');
            this.database.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
                CREATE TABLE IF NOT EXISTS daily_baseline_meta (
                    singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL
                ) STRICT;
                INSERT OR IGNORE INTO daily_baseline_meta VALUES (1,0);
                CREATE TABLE IF NOT EXISTS daily_baseline_manifests (
                    manifest_id TEXT PRIMARY KEY, symbol TEXT NOT NULL, exchange TEXT NOT NULL,
                    source_date TEXT NOT NULL, target_date TEXT NOT NULL, source TEXT NOT NULL,
                    source_version TEXT NOT NULL, payload_hash TEXT NOT NULL,
                    revision INTEGER NOT NULL UNIQUE, manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
                    UNIQUE(symbol,exchange,source_date,target_date)
                ) STRICT;
                CREATE TABLE IF NOT EXISTS daily_baseline_conflicts (
                    conflict_id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, source_date TEXT NOT NULL,
                    attempted_manifest_json TEXT NOT NULL CHECK(json_valid(attempted_manifest_json)),
                    existing_manifest_id TEXT NOT NULL, reason TEXT NOT NULL
                ) STRICT;
                PRAGMA user_version=1;`);
        } catch (error) { this.database.close(); throw error; }
    }

    currentRevision() {
        return this.database.prepare('SELECT revision FROM daily_baseline_meta WHERE singleton=1').get().revision;
    }

    putManifest(manifest, expectedRevision) {
        if (!isDailyMinuteVolumeBaseline(manifest)) throw new TypeError('daily_baseline_manifest_invalid');
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
            throw new TypeError('daily_baseline_revision_invalid');
        }
        const serialized = JSON.stringify(manifest);
        this.database.exec('BEGIN IMMEDIATE');
        let committed = false;
        try {
            const existing = this.database.prepare(`SELECT manifest_id, payload_hash, manifest_json, revision
                FROM daily_baseline_manifests WHERE symbol=? AND exchange=? AND source_date=? AND target_date=?`)
                .get(manifest.symbol, manifest.exchange, manifest.tradeDate, manifest.targetTradeDate);
            if (existing?.manifest_id === manifest.manifestId) {
                const saved = this.parse(existing.manifest_json);
                if (saved.manifestId !== manifest.manifestId) throw new Error('daily_baseline_repository_corrupt');
                this.database.exec('COMMIT'); committed = true;
                return { inserted: false, alreadyPresent: true, revision: existing.revision,
                    manifestId: existing.manifest_id };
            }
            const sourceConflict = this.database.prepare(`SELECT manifest_id, payload_hash
                FROM daily_baseline_manifests WHERE symbol=? AND exchange=? AND source_date=?
                AND source=? AND source_version=? AND payload_hash<>? LIMIT 1`)
                .get(manifest.symbol, manifest.exchange, manifest.tradeDate,
                    manifest.source, manifest.sourceVersion, manifest.payloadHash);
            if (existing || sourceConflict) {
                const conflict = existing ?? sourceConflict;
                this.database.prepare(`INSERT INTO daily_baseline_conflicts
                    (symbol,source_date,attempted_manifest_json,existing_manifest_id,reason) VALUES(?,?,?,?,?)`)
                    .run(manifest.symbol, manifest.tradeDate, serialized,
                        conflict.manifest_id, 'source_payload_or_manifest_conflict');
                this.database.exec('COMMIT'); committed = true;
                throw new Error('daily_baseline_source_conflict');
            }
            if (this.currentRevision() !== expectedRevision) throw new Error('daily_baseline_revision_conflict');
            const revision = expectedRevision + 1;
            this.database.prepare(`INSERT INTO daily_baseline_manifests VALUES(?,?,?,?,?,?,?,?,?,?)`)
                .run(manifest.manifestId, manifest.symbol, manifest.exchange, manifest.tradeDate,
                    manifest.targetTradeDate, manifest.source, manifest.sourceVersion,
                    manifest.payloadHash, revision, serialized);
            this.database.prepare('UPDATE daily_baseline_meta SET revision=? WHERE singleton=1').run(revision);
            this.database.exec('COMMIT'); committed = true;
            return { inserted: true, alreadyPresent: false, revision, manifestId: manifest.manifestId };
        } finally { if (!committed) this.database.exec('ROLLBACK'); }
    }

    parse(serialized) {
        const manifest = JSON.parse(serialized);
        if (!isDailyMinuteVolumeBaseline(manifest)) throw new Error('daily_baseline_repository_corrupt');
        return manifest;
    }

    latestForSymbolDate(symbol, exchange, sourceTradeDate, targetTradeDate) {
        const row = this.database.prepare(`SELECT manifest_json FROM daily_baseline_manifests
            WHERE symbol=? AND exchange=? AND source_date=? AND target_date=?`)
            .get(symbol, exchange, sourceTradeDate, targetTradeDate);
        return row ? this.parse(row.manifest_json) : null;
    }

    hasConflict(symbol, sourceTradeDate) {
        return Boolean(this.database.prepare(`SELECT 1 FROM daily_baseline_conflicts
            WHERE symbol=? AND source_date=? LIMIT 1`).get(symbol, sourceTradeDate));
    }

    listForTargetTradeDate(targetTradeDate) {
        return this.database.prepare(`SELECT manifest_json FROM daily_baseline_manifests
            WHERE target_date=? ORDER BY revision`).all(targetTradeDate)
            .map(row => this.parse(row.manifest_json));
    }

    conflicts() {
        return this.database.prepare('SELECT * FROM daily_baseline_conflicts ORDER BY conflict_id').all();
    }

    close() { this.database.close(); }
}

// Status-only inspection: never creates/migrates the database or claims an absent
// manifest as reconciled. The immutable manifest was validated at insertion.
export function readDailyMinuteVolumeQuality({ databasePath, sourceTradeDate,
    targetTradeDate, symbols } = {}) {
    if (!path.isAbsolute(databasePath ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(sourceTradeDate ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(targetTradeDate ?? '') ||
        !Array.isArray(symbols) || symbols.length < 1 || symbols.length > 160 ||
        new Set(symbols).size !== symbols.length ||
        symbols.some(symbol => !/^\d{4,6}[A-Z]?\.TW(?:O)?$/.test(symbol))) {
        throw new TypeError('daily_baseline_quality_input_invalid');
    }
    const empty = { sourceTradeDate, targetTradeDate, expectedCount: symbols.length,
        readyCount: 0, independentMatchedCount: 0, independentNotObservedCount: 0,
        missingCount: symbols.length, unknownCount: 0, state: 'unavailable' };
    if (!existsSync(databasePath)) return empty;
    let database;
    try {
        database = new DatabaseSync(databasePath, { readOnly: true });
        const rows = database.prepare(`SELECT symbol, exchange,
            json_extract(manifest_json, '$.schemaVersion') AS schema_version,
            json_extract(manifest_json, '$.validationChecks.closeTotalCheck') AS total_check
            FROM daily_baseline_manifests WHERE source_date=? AND target_date=?`)
            .all(sourceTradeDate, targetTradeDate);
        const bySymbol = new Map(rows.map(row => [row.symbol, row]));
        let presentCount = 0, readyCount = 0, independentMatchedCount = 0,
            independentNotObservedCount = 0, unknownCount = 0;
        for (const symbol of symbols) {
            const row = bySymbol.get(symbol);
            if (!row) continue;
            presentCount += 1;
            if (row.exchange !== (symbol.endsWith('.TWO') ? 'OTC' : 'TSE') ||
                row.schema_version !== 'intraday-minute-volume-baseline/2') {
                unknownCount += 1; continue;
            }
            readyCount += 1;
            if (row.total_check === 'matched') independentMatchedCount += 1;
            else if (row.total_check === 'not_observed') independentNotObservedCount += 1;
            else unknownCount += 1;
        }
        return { sourceTradeDate, targetTradeDate, expectedCount: symbols.length,
            readyCount, independentMatchedCount, independentNotObservedCount,
            missingCount: symbols.length - presentCount, unknownCount,
            state: unknownCount ? 'partial_unknown' : 'repository_recorded' };
    } catch { return empty; }
    finally { database?.close(); }
}
