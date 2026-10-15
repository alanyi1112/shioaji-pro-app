/** 將舊基準工作承諾改由同週期 daily-v2 已送出的預留承接；不調低 quote 保護池。 */
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { readDailyMinuteVolumeMode } from './intraday-monitor-runtime/daily-minute-volume-postclose.mjs';
import { readLocalVerifiedDailyIdentity, localVerifiedDailyUsage } from './broker-local-verified-reset-ledger.mjs';
import { readBrokerAccountScopeHash } from './broker-reset-observation.mjs';
import { readScreenerBrokerCommitments } from './stock-screener-broker-commitments.mjs';
import { previewRuntimeBudgetAllocation, observeRuntimeBudgetAllocations }
    from './stock-screener-runtime-budget-producer.mjs';
import { createScreenerBrokerPorts } from './stock-screener-broker-ports.mjs';

const POLICY = 'screener-bollinger-broker-budget-policy';
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = () => { throw new Error('broker_allocation_transition_pending'); };

/** 操作者授權入口；僅讀既有 simulation session 與已驗證的當日帳本。 */
export async function transitionDailyBaselineAllocation({ db, root, fetchImpl = fetch,
    now = () => new Date(), portsFactory = createScreenerBrokerPorts,
    accountHashReader = readBrokerAccountScopeHash } = {}) {
    if (!db?.prepare || !db?.batch || !path.isAbsolute(root ?? '') ||
        typeof now !== 'function') throw new TypeError('broker_allocation_transition_invalid');
    if ((await readDailyMinuteVolumeMode(root)).mode !== 'daily') fail();
    try {
        await lstat(path.join(root, 'direct-160-live', 'registry', 'active.lock'));
        fail();
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const row = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?').bind(POLICY).first();
    if (row?.status !== 'verified') fail();
    const oldPolicy = JSON.parse(row.checkpoint);
    if (oldPolicy.version !== 4 || oldPolicy.identityMode !== 'local-verified-daily-reset-v1' ||
        oldPolicy.consumerObservationMode !== 'baseline-protected-allocation-v1' ||
        oldPolicy.budgetPolicy?.quoteReserveBytes < 300 * 1024 ** 2 ||
        Date.parse(oldPolicy.validThrough) <= now().getTime()) fail();
    const identity = await readLocalVerifiedDailyIdentity(db);
    if (identity.scope !== oldPolicy.scope || identity.quotaEpoch !== oldPolicy.quotaEpoch ||
        identity.quotaEpochEvidenceHash !== oldPolicy.quotaEpochEvidenceHash ||
        identity.identityHash !== oldPolicy.dailyIdentityHash) fail();
    const ports = portsFactory({ db, root, fetchImpl, now });
    const safety = await ports.safety();
    const rawUsage = await ports.observeUsage();
    const accountScopeHash = await accountHashReader({ root, fetchImpl });
    if (accountScopeHash !== identity.accountScopeHash ||
        rawUsage.generation !== safety.generation ||
        now().getTime() - Date.parse(rawUsage.observedAt) > 60_000) fail();
    const usage = await localVerifiedDailyUsage(db, identity, rawUsage, accountScopeHash);
    await observeRuntimeBudgetAllocations({ db, record: oldPolicy, root, now: now() });
    const oldBudget = await readScreenerBrokerCommitments(db, oldPolicy, now());
    const oldHead = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?')
        .bind('broker-consumer-commitment:monitor-baseline-allocation').first();
    if (oldHead?.status !== 'verified' || oldBudget.otherJobCommitments.length !== 1) fail();
    const retained = await db.prepare(`SELECT COUNT(*) n,COALESCE(SUM(estimated_bytes),0) bytes
        FROM broker_bandwidth_reservations WHERE scope=? AND quota_epoch=?
        AND job_key LIKE 'monitor-minute-v2:%' AND status IN ('dispatched','charged','quarantined')`)
        .bind(identity.scope, identity.quotaEpoch).first();
    const active = await db.prepare(`SELECT COUNT(*) n FROM broker_bandwidth_reservations
        WHERE status IN ('reserved','dispatched')`).first();
    if (active?.n !== 0 || !Number.isSafeInteger(retained?.bytes) || retained.bytes <= 0) fail();
    const newPolicy = { ...oldPolicy, consumerObservationMode: 'daily-baseline-allocation-v1',
        budgetPolicy: { ...oldPolicy.budgetPolicy, evidenceHash: sha({
            transition: 'daily-baseline-allocation-v1', previousEvidenceHash: oldPolicy.budgetPolicy.evidenceHash,
            previousPolicyHash: sha(oldPolicy), identityHash: identity.identityHash,
            quoteReserveBytes: oldPolicy.budgetPolicy.quoteReserveBytes }) } };
    const stamp = now(), newProof = await previewRuntimeBudgetAllocation({ db, record: newPolicy, root, now: stamp });
    const estimate = Math.ceil(Math.max(...oldBudget.measurements.map(m => m.usageAfter - m.usageBefore)) *
        oldBudget.estimateMultiplier);
    const free = usage.remainingBytes - newPolicy.budgetPolicy.quoteReserveBytes -
        newProof.remainingBytes - retained.bytes;
    if (safety.simulation !== true || !Number.isSafeInteger(estimate) ||
        estimate < 1 || estimate > oldBudget.maxEstimatedBytes || free < estimate ||
        newProof.remainingBytes >= oldBudget.otherJobCommitments[0].bytes ||
        now().getTime() - stamp.getTime() > 60_000) fail();
    const proof = { ...newProof, evidenceHash: sha(newProof) };
    const previousHash = sha(oldPolicy), archiveId = `broker-budget-policy-archive:${previousHash}`;
    const receipt = { version: 1, kind: 'daily-baseline-allocation-transition',
        observedAt: stamp.toISOString(), previousPolicyHash: previousHash,
        newPolicyHash: sha(newPolicy), identityHash: identity.identityHash,
        generation: safety.generation, rawUsage, oldCommitmentBytes: oldBudget.otherJobCommitments[0].bytes,
        newCommitmentBytes: proof.remainingBytes, retainedCount: retained.n,
        retainedEstimatedBytes: retained.bytes, quoteReserveBytes: oldPolicy.budgetPolicy.quoteReserveBytes,
        nextRequestEstimateBytes: estimate, availableBytes: free };
    const receiptId = `broker-budget-policy-transition:${sha(receipt)}`;
    const newReceiptId = `broker-consumer-observation:${proof.evidenceHash}`;
    const headId = 'broker-consumer-commitment:monitor-baseline-allocation';
    const newHead = JSON.stringify({ version: 2, jobKey: 'monitor-baseline-allocation', receiptId: newReceiptId });
    const oldProof = oldHead.checkpoint, oldCheckpoint = row.checkpoint;
    if ((await ports.safety()).generation !== safety.generation ||
        await accountHashReader({ root, fetchImpl }) !== identity.accountScopeHash ||
        now().getTime() - Date.parse(rawUsage.observedAt) > 60_000) fail();
    const guard = `EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?)
        AND EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?)
        AND NOT EXISTS(SELECT 1 FROM broker_bandwidth_reservations WHERE status IN ('reserved','dispatched'))
        AND (SELECT COUNT(*) FROM broker_bandwidth_reservations WHERE scope=? AND quota_epoch=?
            AND job_key LIKE 'monitor-minute-v2:%' AND status IN ('dispatched','charged','quarantined'))=?
        AND (SELECT COALESCE(SUM(estimated_bytes),0) FROM broker_bandwidth_reservations
            WHERE scope=? AND quota_epoch=? AND job_key LIKE 'monitor-minute-v2:%'
            AND status IN ('dispatched','charged','quarantined'))=?`;
    const args = [POLICY, oldCheckpoint, headId, oldProof, identity.scope, identity.quotaEpoch,
        retained.n, identity.scope, identity.quotaEpoch, retained.bytes];
    const insert = (id, scope, checkpoint) => db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
        SELECT ?,?,'verified',?,? WHERE ${guard} ON CONFLICT(id) DO NOTHING`)
        .bind(id, scope, checkpoint, stamp.toISOString(), ...args);
    const result = await db.batch([
        insert(archiveId, 'broker-budget-policy-archive', oldCheckpoint),
        insert(receiptId, 'broker-budget-policy-transition', JSON.stringify(receipt)),
        db.prepare(`UPDATE screener_runs SET checkpoint=?,updated_at=? WHERE id=? AND checkpoint=? AND ${guard}`)
            .bind(JSON.stringify(newPolicy), stamp.toISOString(), POLICY, oldCheckpoint, ...args),
        db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            SELECT ?,'broker-consumer-observation','verified',?,? WHERE
            EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND checkpoint=?) ON CONFLICT(id) DO NOTHING`)
            .bind(newReceiptId, JSON.stringify(proof), stamp.toISOString(), POLICY, JSON.stringify(newPolicy)),
        db.prepare(`UPDATE screener_runs SET checkpoint=?,updated_at=? WHERE id=? AND status='verified'
            AND checkpoint=? AND EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND checkpoint=?)`)
            .bind(newHead, stamp.toISOString(), headId, oldProof, newReceiptId, JSON.stringify(proof)),
    ]);
    if ((result[2].meta?.changes ?? result[2].changes) !== 1 ||
        (result[4].meta?.changes ?? result[4].changes) !== 1) fail();
    return { state: 'transitioned', receiptId, previousPolicyHash: previousHash,
        newPolicyHash: sha(newPolicy), previousCommitmentBytes: receipt.oldCommitmentBytes,
        newCommitmentBytes: receipt.newCommitmentBytes, retainedEstimatedBytes: retained.bytes,
        quoteReserveBytes: receipt.quoteReserveBytes, availableBytes: free };
}
