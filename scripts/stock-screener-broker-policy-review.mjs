/** 明確授權的操作者複核；不由 watcher 自動延長、不下載、不清除舊債。 */
import { createHash } from 'node:crypto';
import { readLocalConservativeIdentity, localConservativeUsage } from './broker-local-conservative-ledger.mjs';
import { readScreenerBrokerCommitments } from './stock-screener-broker-commitments.mjs';
import { observeRuntimeBudgetAllocations } from './stock-screener-runtime-budget-producer.mjs';
import { validateBrokerBudgetPolicy } from './broker-bandwidth-reservations.mjs';

const POLICY = 'screener-bollinger-broker-budget-policy';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = reason => { throw new Error(reason); };
async function verifyMeasurements(db, measurements) {
    for (const measurement of measurements) {
        const row = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?')
            .bind(`bollinger-calibration-measurement:${measurement.evidenceHash}`).first();
        if (row?.status !== 'observed') fail('broker_measurements_pending');
        const { proof, measurement: saved } = JSON.parse(row.checkpoint);
        if (hash(proof) !== measurement.evidenceHash || JSON.stringify(saved) !== JSON.stringify(measurement)
            || proof.attribution !== 'non-overlapping-shared-usage-upper-bound' || proof.quotaEpochVerified !== false)
            fail('broker_measurements_pending');
        const rawRow = await db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind(proof.rawId).first();
        const endRow = await db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind(proof.endObservationId).first();
        if (!rawRow || !endRow) fail('broker_measurements_pending');
        const raw = JSON.parse(rawRow.checkpoint), end = JSON.parse(endRow.checkpoint);
        if (hash(raw) !== proof.rawHash || raw.date !== proof.date || JSON.stringify(raw.before) !== JSON.stringify(proof.start)
            || JSON.stringify(end.before ?? end) !== JSON.stringify(proof.end)
            || proof.start.generation !== proof.end.generation || proof.start.limitBytes !== proof.end.limitBytes
            || measurement.usageBefore !== proof.start.usedBytes || measurement.usageAfter !== proof.end.usedBytes
            || measurement.observedAt !== proof.end.observedAt || typeof raw.response?.text !== 'string'
            || measurement.responseBytes !== Buffer.byteLength(raw.response.text)
            || Date.parse(proof.end.observedAt) < Date.parse(raw.response.fetchedAt)) fail('broker_measurements_pending');
    }
}

/** 效期最多七日且不能超過實測三十日；原條款、保護池與錨點保持不變。
 * observeAllocations 僅供隔離測試注入；正式入口使用既有 budget producer。
 */
export async function reviewScreenerBrokerPolicy({ db, ports, root, validThrough, now = () => new Date(),
    observeAllocations = observeRuntimeBudgetAllocations }) {
    const started = now(), until = Date.parse(validThrough);
    const row = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?').bind(POLICY).first();
    if (row?.status !== 'verified') fail('broker_policy_pending');
    const record = JSON.parse(row.checkpoint), identity = await readLocalConservativeIdentity(db);
    if (record.version !== 3 || record.identityMode !== 'local-conservative-v1' || record.quotaEpochVerified !== false
        || ['scope','quotaEpoch','quotaEpochEvidenceHash'].some(k => record[k] !== identity[k])
        || record.consumerObservationMode !== 'baseline-protected-allocation-v1'
        || !Number.isFinite(until) || until <= Math.max(started.getTime(), Date.parse(record.validThrough))
        || until - started.getTime() > 7 * 86400000
        || until > Math.min(...record.budgetPolicy.measurements.map(m => Date.parse(m.observedAt) + 30 * 86400000)))
        fail('invalid_broker_policy_review');
    // 本次入口限原政策仍有效時複核；過期／破損不以臨時 observation 自動解鎖。
    if (Date.parse(record.validThrough) <= started.getTime()) fail('broker_policy_pending');
    await verifyMeasurements(db, record.budgetPolicy.measurements);
    await observeAllocations({ db, record, root, now: started });
    const currentBudget = await readScreenerBrokerCommitments(db, record, started);
    if (!validateBrokerBudgetPolicy(currentBudget, started)) fail('broker_policy_pending');
    const rawUsage = await ports.observeUsage();
    const observed = now();
    if (Date.parse(rawUsage.observedAt) > observed.getTime()
        || observed.getTime() - Date.parse(rawUsage.observedAt) > 60000) fail('broker_usage_pending');
    const usage = await localConservativeUsage(db, identity, rawUsage);
    const completed = now();
    if (Date.parse(rawUsage.observedAt) > completed.getTime()
        || completed.getTime() - Date.parse(rawUsage.observedAt) > 60000) fail('broker_usage_pending');
    const commitmentHeads = await Promise.all(record.budgetPolicy.otherConsumerJobKeys.map(async job => {
        const id = `broker-consumer-commitment:${job}`;
        return { id, ...await db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind(id).first() };
    }));
    const budget = await readScreenerBrokerCommitments(db, record, completed);
    const estimate = Math.ceil(Math.max(...budget.measurements.map(m => m.usageAfter - m.usageBefore)) * budget.estimateMultiplier);
    const retained = await db.prepare("SELECT COUNT(*) n,COALESCE(SUM(estimated_bytes),0) bytes FROM broker_bandwidth_reservations WHERE status<>'released'").first();
    const active = await db.prepare("SELECT COUNT(*) n FROM broker_bandwidth_reservations WHERE status IN ('reserved','dispatched')").first();
    const protectedBytes = budget.otherJobCommitments.reduce((n,c) => n+c.bytes, budget.quoteReserveBytes);
    const availableBytes = usage.remainingBytes - protectedBytes - retained.bytes;
    if (!validateBrokerBudgetPolicy(budget, completed) || active.n !== 0 || !Number.isSafeInteger(estimate)
        || estimate < 1 || estimate > budget.maxEstimatedBytes || !Number.isSafeInteger(availableBytes)
        || availableBytes < estimate) fail('broker_policy_review_budget_denied');
    const next = { ...record, validThrough: new Date(until).toISOString(), budgetPolicy: { ...record.budgetPolicy,
        validThrough: new Date(until).toISOString(), evidenceHash: hash({ version: 1,
            previousEvidenceHash: record.budgetPolicy.evidenceHash, reviewedAt: completed.toISOString(), validThrough: new Date(until).toISOString() }) } };
    if (!validateBrokerBudgetPolicy({ ...budget, ...next.budgetPolicy }, completed)) fail('broker_policy_pending');
    const oldHash = hash(record), newHash = hash(next), archiveId = `broker-budget-policy-archive:${oldHash}`;
    const proof = { version: 1, trigger: 'authorized-operator-review', reviewedAt: completed.toISOString(),
        previousPolicyHash: oldHash, newPolicyHash: newHash, previousValidThrough: record.validThrough, validThrough: next.validThrough,
        identityHash: identity.quotaEpochEvidenceHash, providerQuotaEpochVerified: false,
        rawUsage, conservativeUsedBytes: usage.usedBytes, conservativeRemainingBytes: usage.remainingBytes,
        retainedCount: retained.n, retainedEstimatedBytes: retained.bytes, protectedBytes, estimate, availableBytes,
        commitmentEvidenceHash: budget.evidenceHash, measurementHashes: budget.measurements.map(m => m.evidenceHash) };
    const receiptId = `broker-budget-policy-review:${hash(proof)}`;
    const counterId = `broker-local-counter:${identity.quotaEpochEvidenceHash}`;
    const counter = await db.prepare('SELECT checkpoint FROM screener_runs WHERE id=?').bind(counterId).first();
    const counterProof = JSON.parse(counter?.checkpoint ?? '{}');
    if (counterProof.rawUsedBytes !== rawUsage.usedBytes || counterProof.conservativeUsedBytes !== usage.usedBytes
        || counterProof.limitBytes !== rawUsage.limitBytes || counterProof.observedAt !== rawUsage.observedAt
        || counterProof.identityHash !== identity.quotaEpochEvidenceHash) fail('broker_policy_review_raced');
    const anchor = await db.prepare("SELECT checkpoint FROM screener_runs WHERE id='broker-local-conservative-anchor'").first();
    const guard = `EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?)
        AND EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?)
        AND EXISTS(SELECT 1 FROM screener_runs WHERE id='broker-local-conservative-anchor' AND status='verified' AND checkpoint=?)
        AND (SELECT COALESCE(SUM(estimated_bytes),0) FROM broker_bandwidth_reservations WHERE status<>'released')=?
        AND (SELECT COUNT(*) FROM broker_bandwidth_reservations WHERE status<>'released')=?
        AND NOT EXISTS(SELECT 1 FROM broker_bandwidth_reservations WHERE status IN ('reserved','dispatched'))
        ${commitmentHeads.map(() => "AND EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?)").join(' ')}`;
    const args = [POLICY, row.checkpoint, counterId, counter.checkpoint, anchor.checkpoint, retained.bytes, retained.n,
        ...commitmentHeads.flatMap(h => [h.id, h.checkpoint])];
    const stamp = completed.toISOString(), archive = JSON.stringify(record), receipt = JSON.stringify({ proof, policy: next });
    const results = await db.batch([
        db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            SELECT ?,'broker-budget-policy-archive','verified',?,? WHERE ${guard} ON CONFLICT(id) DO NOTHING`)
            .bind(archiveId, archive, stamp, ...args),
        db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            SELECT ?,'broker-budget-policy-review','verified',?,? WHERE ${guard} ON CONFLICT(id) DO NOTHING`)
            .bind(receiptId, receipt, stamp, ...args),
        db.prepare(`UPDATE screener_runs SET checkpoint=?,updated_at=? WHERE id=? AND status='verified' AND checkpoint=?
            AND EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?)
            AND EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?) AND ${guard}`)
            .bind(JSON.stringify(next), stamp, POLICY, row.checkpoint, archiveId, archive, receiptId, receipt, ...args),
    ]);
    if ((results.at(-1).meta?.changes ?? results.at(-1).changes) !== 1) fail('broker_policy_review_raced');
    return { state: 'reviewed', receiptId, previousValidThrough: record.validThrough, validThrough: next.validThrough,
        conservativeUsedBytes: usage.usedBytes, conservativeRemainingBytes: usage.remainingBytes,
        protectedBytes, retainedEstimatedBytes: retained.bytes, estimatedBytes: estimate, availableBytes };
}
