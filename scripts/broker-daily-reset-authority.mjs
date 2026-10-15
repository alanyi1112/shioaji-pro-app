/** 從已保存來源收據與正式盤前雙市場日曆建立非授權 reset witness。 */
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { readBrokerResetObservation } from './broker-reset-observation.mjs';
import { classifyBrokerDailyResetWitness } from './broker-daily-reset-witness.mjs';
import { resolveIntradayMonitorPremarketTradingDay }
    from './intraday-monitor-runtime/trading-calendar-authority.mjs';
import { verifyDailyCalendarCache } from './intraday-monitor-runtime/daily-calendar-cache.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');

export async function buildBrokerDailyResetWitnessFromSavedEvidence({ root,
    beforeEvidenceHash, afterEvidenceHash, now = new Date(),
    resolveTradingDay = resolveIntradayMonitorPremarketTradingDay } = {}) {
    if (!path.isAbsolute(root ?? '') || !(now instanceof Date) || !Number.isFinite(now.valueOf()) ||
        typeof resolveTradingDay !== 'function') {
        throw new TypeError('broker_daily_reset_authority_input_invalid');
    }
    const [before, after, authority] = await Promise.all([
        readBrokerResetObservation({ root, evidenceHash: beforeEvidenceHash }),
        readBrokerResetObservation({ root, evidenceHash: afterEvidenceHash }),
        resolveTradingDay({ root, now }),
    ]);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    if (authority?.current !== true || authority.isTradingDate !== true ||
        authority.tradeDate !== date ||
        !/^\d{4}-\d{2}-\d{2}$/.test(authority.previousTradeDate ?? '') ||
        !['verified_postclose_local_snapshot', 'verified_daily_official_calendar_cache'].includes(authority.authorityKind) ||
        !Array.isArray(authority.sourceVersions) || !authority.sourceVersions.length ||
        typeof authority.verifiedArtifactPath !== 'string') {
        throw new Error('broker_daily_reset_official_session_unverified');
    }
    const file = authority.verifiedArtifactPath;
    const daily = authority.authorityKind === 'verified_daily_official_calendar_cache';
    const relative = path.relative(path.join(root, daily ? 'IntradayMonitor/official-calendar-cache' : 'intraday-baselines'), file);
    if (relative.startsWith('..') || path.isAbsolute(relative) ||
        !(daily ? /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{64}\.json$/
            : /^[0-9]{4}-[0-9]{2}-[0-9]{2}-for-[0-9]{4}-[0-9]{2}-[0-9]{2}-verified\/baseline-set\.json$/).test(relative)) {
        throw new Error('broker_daily_reset_calendar_path_invalid');
    }
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
        stat.mode & 0o077 || stat.size < 2 || stat.size > 16 * 1024 ** 2 ||
        await realpath(file) !== file) {
        throw new Error('broker_daily_reset_calendar_file_invalid');
    }
    if (daily) {
        const cached = JSON.parse(await readFile(file, 'utf8'));
        const verified = verifyDailyCalendarCache(cached, now);
        if (!authority.sourceVersions.includes(verified.calendarVersion) ||
            cached.targetTradeDate < date && now.valueOf() - Date.parse(cached.fetchedAt) > 7 * 86400000) {
            throw new Error('broker_daily_reset_calendar_file_invalid');
        }
    }
    const officialEvidenceHash = sha(JSON.stringify({
        schemaVersion: 'broker-daily-reset-official-session/1',
        tradeDate: date, sourceVersions: authority.sourceVersions,
        artifactHash: sha(await readFile(file)),
        authorityKind: authority.authorityKind,
    }));
    const raw = observation => ({ generation: observation.generation,
        usedBytes: observation.usedBytes, remainingBytes: observation.remainingBytes,
        limitBytes: observation.limitBytes, observedAt: observation.observedAt });
    const witness = classifyBrokerDailyResetWitness({ before: raw(before), after: raw(after),
        beforeAccountHash: before.accountScopeHash,
        afterAccountHash: after.accountScopeHash,
        tradingDay: { tradeDate: date, previousTradeDate: authority.previousTradeDate,
            twseTradingDay: true,
            tpexTradingDay: true, officialEvidenceHash,
            verifiedAt: authority.observedAt }, observedAt: now.toISOString() });
    if (witness.state !== 'candidate') throw new Error(`broker_daily_reset_${witness.reason}`);
    return Object.freeze({ witness, beforeEvidenceHash, afterEvidenceHash,
        officialEvidenceHash, authorityKind: authority.authorityKind,
        admissionAuthority: false });
}
