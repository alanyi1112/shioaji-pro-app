/** 本機盤前排程的有界額度續轉；Codex 不參與常態 admission。 */
import path from 'node:path';
import { ScreenerSqlite } from '../stock-screener-sqlite.mjs';
import { findPreviousBrokerResetObservation }
    from '../broker-reset-observation.mjs';
import { prepareBrokerDailyResetActivation, commitBrokerDailyResetActivation }
    from '../broker-daily-reset-activation.mjs';
import { readDailyMinuteVolumeMode } from './daily-minute-volume-postclose.mjs';

export async function runPremarketBrokerDailyReset({ root, authority,
    now = () => new Date(), openDatabase = file => new ScreenerSqlite(file),
    findBefore = findPreviousBrokerResetObservation,
    prepare = prepareBrokerDailyResetActivation,
    commit = commitBrokerDailyResetActivation } = {}) {
    if (!path.isAbsolute(root ?? '') || authority?.isTradingDate !== true ||
        !/^\d{4}-\d{2}-\d{2}$/.test(authority.tradeDate ?? '') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(authority.previousTradeDate ?? '')) {
        throw new TypeError('premarket_broker_reset_input_invalid');
    }
    const mode = await readDailyMinuteVolumeMode(root);
    if (mode.mode !== 'daily') return { state: 'not_applicable' };
    const db = openDatabase(mode.screenerDatabasePath);
    try {
        const row = await db.prepare(`SELECT status,checkpoint FROM screener_runs
            WHERE id='screener-bollinger-broker-budget-policy'`).first();
        if (row?.status !== 'verified') return { state: 'waiting', reason: 'policy_missing' };
        const policy = JSON.parse(row.checkpoint);
        if (policy.version === 4 && policy.quotaEpoch === `local-daily:${authority.tradeDate}`) {
            return { state: 'current', quotaEpoch: policy.quotaEpoch };
        }
        const resetAt = new Date(`${authority.tradeDate}T08:00:00+08:00`);
        const before = await findBefore({ root, previousTradeDate: authority.previousTradeDate,
            resetAt });
        if (!before) return { state: 'waiting', reason: 'previous_usage_anchor_missing' };
        const prepared = await prepare({ db, root, beforeEvidenceHash: before.evidenceHash,
            now });
        const result = await commit({ db, root, prepared, now });
        return { state: result.state === 'migrated' ? 'current' : 'waiting',
            quotaEpoch: prepared.plan.identity.quotaEpoch,
            evidenceHash: prepared.witness.evidenceHash,
            reason: result.state === 'migrated' ? null : 'migration_not_committed' };
    } catch (error) {
        return { state: 'waiting', reason: String(error?.message ?? 'broker_daily_reset_failed').slice(0, 128) };
    } finally { db.close(); }
}
