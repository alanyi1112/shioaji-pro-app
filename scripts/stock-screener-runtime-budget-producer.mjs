/** 真實盤後基準預算的保守配置觀察；不是宣稱背景工作完成或剩餘消耗為零。 */
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createBaselineBandwidthBudget } from './intraday-monitor-runtime/baseline-bandwidth-budget.mjs';
import { saveScreenerBrokerCommitment } from './stock-screener-broker-commitments.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
export async function previewRuntimeBudgetAllocation({ db, record, root, now = new Date() }) {
    if (![3, 4].includes(record?.version) ||
        !['baseline-protected-allocation-v1', 'daily-baseline-allocation-v1'].includes(record.consumerObservationMode)
        || JSON.stringify(record.budgetPolicy?.otherConsumerJobKeys) !== JSON.stringify(['monitor-baseline-allocation'])
        || !Number.isSafeInteger(record.minimumBaselineAllocationBytes) || record.minimumBaselineAllocationBytes <= 0)
        throw new Error('broker_policy_pending');
    const directory = path.join(root, 'IntradayMonitor/postclose-baseline/budgets');
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory() || info.uid !== process.getuid() || await realpath(directory) !== directory)
        throw new Error('broker_policy_pending');
    const names = (await readdir(directory)).filter(n => /^\d{4}-\d{2}-\d{2}(?:-attempt-0[23])?\.json$/.test(n)).sort();
    const name = names.at(-1);
    if (!name) throw new Error('broker_policy_pending');
    const file = path.join(directory, name), stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 || stat.size > 65536
        || now.getTime() - stat.mtimeMs > 30 * 86400000 || stat.mtimeMs > now.getTime() + 1000
        || await realpath(file) !== file) throw new Error('broker_policy_pending');
    const raw = await readFile(file, 'utf8'), budget = JSON.parse(raw);
    if (budget.schemaVersion !== 'intraday-monitor-baseline-bandwidth-budget/1'
        || budget.tradeDate !== name.slice(0,10)) throw new Error('broker_policy_pending');
    const recomputed = createBaselineBandwidthBudget({ usage: { bytes: budget.providerUsedBytes,
        limit_bytes: budget.providerLimitBytes, remaining_bytes: budget.providerRemainingBytes }, samples: budget.samples,
        manifestHash: budget.manifestHash, tradeDate: budget.tradeDate, attempt: budget.attempt, observedAt: budget.observedAt });
    if (recomputed.forecastBytes !== budget.forecastBytes || recomputed.reserveBytes !== budget.reserveBytes)
        throw new Error('broker_policy_pending');
    // Explicit revised policy only: transfer this one legacy baseline allocation
    // to dispatched/charged daily-v2 reservations. Reserved-but-not-dispatched
    // requests remain protected by BOTH sides until start() checks the same
    // policy fingerprint, preventing the reservation from invalidating itself.
    const protectedForecast = Math.max(budget.forecastBytes, record.minimumBaselineAllocationBytes);
    let dailyRetainedBytes = 0, dailyModeEvidenceHash = null;
    if (record.consumerObservationMode === 'daily-baseline-allocation-v1') {
        const { readDailyMinuteVolumeMode } = await import('./intraday-monitor-runtime/daily-minute-volume-postclose.mjs');
        const mode = await readDailyMinuteVolumeMode(root);
        if (mode.mode === 'daily') {
            const retained = await db.prepare(`SELECT COALESCE(SUM(estimated_bytes),0) bytes
                FROM broker_bandwidth_reservations WHERE scope=? AND quota_epoch=?
                AND job_key LIKE 'monitor-minute-v2:%'
                AND status IN ('dispatched','charged','quarantined')`)
                .bind(record.scope, record.quotaEpoch).first();
            if (!Number.isSafeInteger(retained?.bytes) || retained.bytes < 0)
                throw new Error('broker_policy_pending');
            dailyRetainedBytes = retained.bytes;
            dailyModeEvidenceHash = sha(JSON.stringify(mode));
        }
    }
    const remainingBytes = Math.max(0, protectedForecast - dailyRetainedBytes);
    const source = record.consumerObservationMode === 'baseline-protected-allocation-v1'
        ? { version: 1, budgetHash: sha(raw), allocationMode: 'protected-full-forecast-not-remaining-job-usage',
            minimumBytes: record.minimumBaselineAllocationBytes }
        : { version: 1, budgetHash: sha(raw), allocationMode: record.consumerObservationMode,
            minimumBytes: record.minimumBaselineAllocationBytes, dailyRetainedBytes, dailyModeEvidenceHash };
    const proof = { version: 1, jobKey: 'monitor-baseline-allocation', scope: record.scope, quotaEpoch: record.quotaEpoch,
        quotaEpochEvidenceHash: record.quotaEpochEvidenceHash, observedAt: now.toISOString(), remainingBytes,
        state: remainingBytes === 0 ? 'complete' : 'committed',
        sourceEvidenceHash: sha(JSON.stringify(source)) };
    return proof;
}

export async function observeRuntimeBudgetAllocations(input) {
    const proof = await previewRuntimeBudgetAllocation(input);
    return saveScreenerBrokerCommitment(input.db, input.record, proof, input.now ?? new Date());
}
