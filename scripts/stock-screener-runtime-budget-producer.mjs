/** 真實盤後基準預算的保守配置觀察；不是宣稱背景工作完成或剩餘消耗為零。 */
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createBaselineBandwidthBudget } from './intraday-monitor-runtime/baseline-bandwidth-budget.mjs';
import { saveScreenerBrokerCommitment } from './stock-screener-broker-commitments.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
export async function observeRuntimeBudgetAllocations({ db, record, root, now = new Date() }) {
    if (record?.version !== 3 || record.consumerObservationMode !== 'baseline-protected-allocation-v1'
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
    // 保留整份實測 forecast，即使昨日工作已完成也不釋放；另外的互動／未知工作由 quoteReserveBytes 保護。
    const remainingBytes = Math.max(budget.forecastBytes, record.minimumBaselineAllocationBytes);
    const proof = { version: 1, jobKey: 'monitor-baseline-allocation', scope: record.scope, quotaEpoch: record.quotaEpoch,
        quotaEpochEvidenceHash: record.quotaEpochEvidenceHash, observedAt: now.toISOString(), remainingBytes,
        state: 'committed', sourceEvidenceHash: sha(JSON.stringify({ version: 1, budgetHash: sha(raw),
            allocationMode: 'protected-full-forecast-not-remaining-job-usage', minimumBytes: record.minimumBaselineAllocationBytes })) };
    return saveScreenerBrokerCommitment(db, record, proof, now);
}
