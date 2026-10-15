/** 新券商日額度週期的版本化遷移；只在正式來源證據與全窗口預算成立時寫入。 */
import { createHash, randomUUID } from 'node:crypto';
import { createLocalVerifiedDailyIdentity, readLocalVerifiedDailyIdentity }
    from './broker-local-verified-reset-ledger.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex = value => /^[a-f0-9]{64}$/.test(value ?? '');
const safe = value => Number.isSafeInteger(value) && value >= 0;
const POLICY = 'screener-bollinger-broker-budget-policy';

export function planBrokerDailyResetMigration({ oldPolicy, oldCommitments,
    previousDailyIdentity = null, witness, missingRequests, now = new Date() } = {}) {
    if (!(now instanceof Date) || !Number.isFinite(now.valueOf()) ||
        ![3, 4].includes(oldPolicy?.version) || oldPolicy.quotaEpochVerified !== false ||
        oldPolicy.identityMode !== (oldPolicy.version === 3 ? 'local-conservative-v1'
            : 'local-verified-daily-reset-v1') ||
        (oldPolicy.version === 4 && (!hex(oldPolicy.dailyIdentityHash) ||
            previousDailyIdentity?.identityHash !== oldPolicy.dailyIdentityHash ||
            previousDailyIdentity?.quotaEpochEvidenceHash !== oldPolicy.quotaEpochEvidenceHash ||
            previousDailyIdentity?.scope !== oldPolicy.scope ||
            previousDailyIdentity?.accountScopeHash !== witness?.proof?.accountScopeHash ||
            !/^local-daily:\d{4}-\d{2}-\d{2}$/.test(oldPolicy.quotaEpoch ?? '') ||
            witness?.proof?.tradingDay <= oldPolicy.quotaEpoch.slice('local-daily:'.length))) ||
        (oldPolicy.version === 3 && previousDailyIdentity != null) ||
        !hex(oldPolicy.scope) || !hex(oldPolicy.quotaEpochEvidenceHash) ||
        !Number.isFinite(Date.parse(oldPolicy.validThrough)) ||
        Date.parse(oldPolicy.validThrough) <= now.getTime() ||
        !Array.isArray(oldCommitments) ||
        oldCommitments.length !== oldPolicy.budgetPolicy?.otherConsumerJobKeys?.length ||
        oldCommitments.some(proof => !oldPolicy.budgetPolicy.otherConsumerJobKeys.includes(proof?.jobKey) ||
            proof.scope !== oldPolicy.scope || proof.quotaEpoch !== oldPolicy.quotaEpoch ||
            proof.quotaEpochEvidenceHash !== oldPolicy.quotaEpochEvidenceHash ||
            !hex(proof.evidenceHash) || !hex(proof.sourceEvidenceHash) ||
            proof.evidenceHash !== sha(Object.fromEntries(Object.entries(proof).filter(([key]) => key !== 'evidenceHash'))) ||
            !safe(proof.remainingBytes) || !['committed', 'complete'].includes(proof.state) ||
            !Number.isFinite(Date.parse(proof.observedAt)) ||
            now.getTime() - Date.parse(proof.observedAt) > 60_000) ||
        new Set(oldCommitments.map(proof => proof.jobKey)).size !== oldCommitments.length ||
        witness?.state !== 'candidate' || witness.authorizesAdmission !== false ||
        witness.evidenceHash !== sha(witness.proof) ||
        !safe(witness.proof?.after?.usedBytes) ||
        !safe(witness.proof?.after?.remainingBytes) ||
        !safe(witness.proof?.after?.limitBytes) ||
        witness.proof.after.usedBytes + witness.proof.after.remainingBytes !== witness.proof.after.limitBytes ||
        now.getTime() - Date.parse(witness.proof.after.observedAt) > 60_000 ||
        Date.parse(witness.proof.after.observedAt) > now.getTime() ||
        // 首輪切換先以 160 合約 + 160 KBar 全數估量；不能由呼叫者
        // 任意聲稱已快取來縮小保護額度。後續逐檔缺件仍由每筆 admission 控制。
        missingRequests !== 320 ||
        !safe(oldPolicy.budgetPolicy.quoteReserveBytes) ||
        oldPolicy.budgetPolicy.quoteReserveBytes < 300 * 1024 ** 2 ||
        (oldPolicy.consumerObservationMode === 'daily-baseline-allocation-v1' &&
            (!safe(oldPolicy.minimumBaselineAllocationBytes) ||
                oldPolicy.minimumBaselineAllocationBytes < 1)) ||
        !Number.isFinite(oldPolicy.budgetPolicy.estimateMultiplier) ||
        !Array.isArray(oldPolicy.budgetPolicy.measurements) ||
        oldPolicy.budgetPolicy.measurements.length < 2 ||
        oldPolicy.budgetPolicy.measurements.some(value =>
            !Number.isFinite(Date.parse(value.observedAt ?? '')) ||
            Date.parse(value.observedAt) > now.getTime())) {
        throw new Error('broker_daily_migration_inputs_invalid');
    }
    const estimate = Math.ceil(Math.max(...oldPolicy.budgetPolicy.measurements.map(value =>
        value.usageAfter - value.usageBefore)) * oldPolicy.budgetPolicy.estimateMultiplier);
    // 上一額度週期的 daily-v2 已送預留可將舊工作承諾降到零；新週期
    // 尚未送出任何逐筆請求，必須先恢復完整基準保留底額，不能沿用零。
    const nextCommitmentBytes = value => oldPolicy.consumerObservationMode === 'daily-baseline-allocation-v1'
        && value.jobKey === 'monitor-baseline-allocation'
        ? Math.max(value.remainingBytes, oldPolicy.minimumBaselineAllocationBytes)
        : value.remainingBytes;
    const commitments = oldCommitments.reduce((sum, value) => sum + nextCommitmentBytes(value), 0);
    const required = estimate * missingRequests;
    // monitor-baseline-allocation reserves this very same 160-contract/KBar
    // job. Count only the full-window forecast above that allocation; adding
    // both in full would falsely require the same work's bytes twice.
    const baselineCommitment = oldCommitments
        .filter(value => value.jobKey === 'monitor-baseline-allocation')
        .reduce((sum, value) => sum + nextCommitmentBytes(value), 0);
    const requiredTopUp = Math.max(0, required - baselineCommitment);
    const available = witness.proof.after.remainingBytes - oldPolicy.budgetPolicy.quoteReserveBytes - commitments;
    if (![estimate, commitments, required, baselineCommitment, requiredTopUp, available].every(Number.isSafeInteger) ||
        estimate < 1 || estimate > oldPolicy.budgetPolicy.maxEstimatedBytes ||
        available < requiredTopUp) throw new Error('broker_daily_migration_full_window_budget_denied');
    const identity = createLocalVerifiedDailyIdentity({ previous: oldPolicy, witness });
    const observedAt = now.toISOString();
    const newCommitments = oldCommitments.map(previous => {
        const proof = { version: 1, jobKey: previous.jobKey, scope: identity.scope,
            quotaEpoch: identity.quotaEpoch, quotaEpochEvidenceHash: identity.quotaEpochEvidenceHash,
            observedAt, remainingBytes: nextCommitmentBytes(previous),
            state: nextCommitmentBytes(previous) === 0 ? 'complete' : 'committed',
            sourceEvidenceHash: sha({ previousEvidenceHash: previous.evidenceHash,
                resetEvidenceHash: witness.evidenceHash,
                transfer: oldPolicy.consumerObservationMode === 'daily-baseline-allocation-v1'
                    ? 'new-epoch-baseline-allocation-restored' : 'same-protected-work-not-consumed',
                previousBytes: previous.remainingBytes,
                newBytes: nextCommitmentBytes(previous) }) };
        return { ...proof, evidenceHash: sha(proof) };
    });
    // A real reset witness plus the full-window admission review renews the
    // policy for at most seven days, and never beyond the oldest calibration's
    // 30-day lifetime. Without fresh calibration, migration fails closed.
    const calibrationDeadline = Math.min(...oldPolicy.budgetPolicy.measurements.map(value =>
        Date.parse(value.observedAt) + 30 * 86400000));
    const reviewedUntil = Math.min(now.getTime() + 7 * 86400000, calibrationDeadline);
    if (reviewedUntil <= now.getTime() || Date.parse(oldPolicy.validThrough) > calibrationDeadline) {
        throw new Error('broker_daily_migration_measurements_expired');
    }
    const validThrough = new Date(Math.max(Date.parse(oldPolicy.validThrough), reviewedUntil)).toISOString();
    const policy = { ...oldPolicy, version: 4, identityMode: identity.identityMode,
        quotaEpochVerified: false, quotaEpoch: identity.quotaEpoch,
        quotaEpochEvidenceHash: identity.quotaEpochEvidenceHash,
        dailyIdentityHash: identity.identityHash,
        validThrough,
        budgetPolicy: { ...oldPolicy.budgetPolicy,
            validThrough,
            evidenceHash: sha({ previousEvidenceHash: oldPolicy.budgetPolicy.evidenceHash,
                resetEvidenceHash: witness.evidenceHash,
                quoteReserveBytes: oldPolicy.budgetPolicy.quoteReserveBytes,
                validThrough }) } };
    return Object.freeze({ identity, policy, newCommitments, missingRequests,
        previousDailyIdentityHash: previousDailyIdentity?.identityHash ?? null,
        plannedAt: observedAt, requiredBytes: required,
        requiredTopUpBytes: requiredTopUp,
        availableBytes: available, headroomBytes: available - requiredTopUp,
        quoteReserveBytes: oldPolicy.budgetPolicy.quoteReserveBytes,
        oldPolicyHash: sha(oldPolicy), newPolicyHash: sha(policy), witnessHash: witness.evidenceHash });
}

/** 寫入前的官方證據與帳戶／用量讀取必須由呼叫者另外完成；本函式不做 HTTP 或 login。 */
export async function persistBrokerDailyResetMigration({ db, plan, previousPolicy,
    previousCommitments, previousDailyIdentity = null, witness, now = new Date() } = {}) {
    if (!db?.prepare || !db?.batch || !plan || !previousPolicy ||
        plan.oldPolicyHash !== sha(previousPolicy) || plan.witnessHash !== witness?.evidenceHash ||
        plan.newPolicyHash !== sha(plan.policy) ||
        now.getTime() - Date.parse(witness.proof.after.observedAt) > 60_000 ||
        now.getTime() - Date.parse(plan.identity.observedAt) > 60_000) {
        throw new Error('broker_daily_migration_plan_invalid');
    }
    const expected = planBrokerDailyResetMigration({ oldPolicy: previousPolicy,
        oldCommitments: previousCommitments, previousDailyIdentity, witness,
        missingRequests: plan.missingRequests, now: new Date(plan.plannedAt) });
    if (JSON.stringify(expected) !== JSON.stringify(plan)) {
        throw new Error('broker_daily_migration_plan_invalid');
    }
    const old = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?').bind(POLICY).first();
    if (old?.status !== 'verified' || old.checkpoint !== JSON.stringify(previousPolicy)) {
        throw new Error('broker_daily_migration_policy_changed');
    }
    const active = await db.prepare(`SELECT COUNT(*) n FROM broker_bandwidth_reservations
        WHERE status IN ('reserved','dispatched')`).first();
    if (active?.n !== 0) throw new Error('broker_daily_migration_active_reservation');
    const oldHeads = [];
    for (const previous of previousCommitments) {
        const id = `broker-consumer-commitment:${previous.jobKey}`;
        const row = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?').bind(id).first();
        if (row?.status !== 'verified' || !row.checkpoint) throw new Error('broker_daily_migration_commitment_changed');
        const parsed = JSON.parse(row.checkpoint);
        if (parsed.evidenceHash !== previous.evidenceHash &&
            parsed.receiptId !== `broker-consumer-observation:${previous.evidenceHash}`) {
            throw new Error('broker_daily_migration_commitment_changed');
        }
        if (parsed.receiptId) {
            const saved = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?')
                .bind(parsed.receiptId).first();
            if (saved?.status !== 'verified' || saved.checkpoint !== JSON.stringify(previous)) {
                throw new Error('broker_daily_migration_commitment_changed');
            }
        }
        oldHeads.push({ id, checkpoint: row.checkpoint,
            legacyProof: parsed.receiptId ? null : previous });
    }
    const anchor = await db.prepare(`SELECT status,checkpoint FROM screener_runs
        WHERE id='broker-local-conservative-anchor'`).first();
    if (anchor?.status !== 'verified' || !anchor.checkpoint ||
        (previousPolicy.version === 3 &&
            JSON.parse(anchor.checkpoint).quotaEpochEvidenceHash !== previousPolicy.quotaEpochEvidenceHash)) {
        throw new Error('broker_daily_migration_anchor_changed');
    }
    const resetHead = await db.prepare(`SELECT status,checkpoint FROM screener_runs
        WHERE id='broker-local-daily-reset-head'`).first();
    let previousResetProof;
    try { previousResetProof = JSON.parse(resetHead?.checkpoint); }
    catch { previousResetProof = null; }
    if (previousPolicy.version === 4) {
        const verified = await readLocalVerifiedDailyIdentity(db);
        if (JSON.stringify(verified) !== JSON.stringify(previousDailyIdentity)) {
            throw new Error('broker_daily_migration_identity_changed');
        }
    }
    if (previousPolicy.version === 3 ? resetHead != null :
        resetHead?.status !== 'verified' ||
        previousResetProof?.identityHash !== previousDailyIdentity?.identityHash) {
        throw new Error('broker_daily_migration_identity_changed');
    }
    const at = now.toISOString(), archiveId = `broker-budget-policy-archive:${plan.oldPolicyHash}`;
    const guard = `EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?)
        AND EXISTS(SELECT 1 FROM screener_runs WHERE id='broker-local-conservative-anchor' AND status='verified' AND checkpoint=?)
        AND ${previousPolicy.version === 3
            ? "NOT EXISTS(SELECT 1 FROM screener_runs WHERE id='broker-local-daily-reset-head')"
            : "EXISTS(SELECT 1 FROM screener_runs WHERE id='broker-local-daily-reset-head' AND status='verified' AND checkpoint=?)"}
        AND NOT EXISTS(SELECT 1 FROM broker_bandwidth_reservations WHERE status IN ('reserved','dispatched'))
        ${oldHeads.map(() => "AND EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?)").join(' ')}`;
    const args = [POLICY, old.checkpoint, anchor.checkpoint,
        ...(previousPolicy.version === 4 ? [resetHead.checkpoint] : []),
        ...oldHeads.flatMap(head => [head.id, head.checkpoint])];
    const statements = [db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
        SELECT ?,'broker-budget-policy-archive','verified',?,? WHERE ${guard} ON CONFLICT(id) DO NOTHING`)
        .bind(archiveId, old.checkpoint, at, ...args),
    db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
        SELECT ?,'broker-daily-reset-witness','verified',?,? WHERE ${guard} ON CONFLICT(id) DO NOTHING`)
        .bind(`broker-daily-reset-witness:${witness.evidenceHash}`, JSON.stringify(witness.proof), at, ...args),
    ];
    if (previousPolicy.version === 3) {
        statements.push(db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            SELECT 'broker-local-daily-reset-head','broker-local-daily-reset','verified',?,? WHERE ${guard}
            ON CONFLICT(id) DO NOTHING`).bind(JSON.stringify(plan.identity), at, ...args));
    } else {
        statements.push(db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            SELECT ?,'broker-local-daily-reset-archive','verified',?,? WHERE ${guard}
            ON CONFLICT(id) DO NOTHING`).bind(`broker-local-daily-reset-archive:${previousDailyIdentity.identityHash}`,
                resetHead.checkpoint, at, ...args));
        statements.push(db.prepare(`UPDATE screener_runs SET checkpoint=?,updated_at=?
            WHERE id='broker-local-daily-reset-head' AND status='verified' AND checkpoint=? AND EXISTS
            (SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?)`)
            .bind(JSON.stringify(plan.identity), at, resetHead.checkpoint,
                `broker-daily-reset-witness:${witness.evidenceHash}`, JSON.stringify(witness.proof)));
    }
    for (const [index, proof] of plan.newCommitments.entries()) {
        const id = `broker-consumer-observation:${proof.evidenceHash}`;
        if (oldHeads[index].legacyProof) {
            const legacy = oldHeads[index].legacyProof;
            statements.push(db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
                SELECT ?,'broker-consumer-observation','verified',?,? WHERE EXISTS
                (SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?)
                ON CONFLICT(id) DO NOTHING`).bind(`broker-consumer-observation:${legacy.evidenceHash}`,
                    JSON.stringify(legacy), at, oldHeads[index].id, oldHeads[index].checkpoint));
        }
        statements.push(db.prepare(`INSERT INTO screener_runs(id,scope,status,checkpoint,updated_at)
            SELECT ?,'broker-consumer-observation','verified',?,? WHERE EXISTS
            (SELECT 1 FROM screener_runs WHERE id='broker-local-daily-reset-head' AND status='verified' AND checkpoint=?)
            ON CONFLICT(id) DO NOTHING`).bind(id, JSON.stringify(proof), at, JSON.stringify(plan.identity)));
        statements.push(db.prepare(`UPDATE screener_runs SET checkpoint=?,updated_at=?
            WHERE id=? AND status='verified' AND checkpoint=? AND EXISTS
            (SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?)`)
            .bind(JSON.stringify({ version: 2, jobKey: proof.jobKey, receiptId: id }), at,
                oldHeads[index].id, oldHeads[index].checkpoint, id, JSON.stringify(proof)));
    }
    statements.push(db.prepare(`UPDATE screener_runs SET checkpoint=?,updated_at=?
        WHERE id=? AND status='verified' AND checkpoint=? AND EXISTS
        (SELECT 1 FROM screener_runs WHERE id='broker-local-daily-reset-head' AND status='verified' AND checkpoint=?)
        ${plan.newCommitments.map(() => "AND EXISTS(SELECT 1 FROM screener_runs WHERE id=? AND status='verified' AND checkpoint=?)").join(' ')}
        AND NOT EXISTS(SELECT 1 FROM broker_bandwidth_reservations WHERE status IN ('reserved','dispatched'))`)
        .bind(JSON.stringify(plan.policy), at, POLICY, old.checkpoint, JSON.stringify(plan.identity),
            ...plan.newCommitments.flatMap(proof => [`broker-consumer-commitment:${proof.jobKey}`,
                JSON.stringify({ version: 2, jobKey: proof.jobKey,
                    receiptId: `broker-consumer-observation:${proof.evidenceHash}` })])));
    // SQLite/D1 batch is transactional. A lost final CAS must raise (not only
    // report zero changes), so earlier identity/commitment inserts roll back.
    statements.push(db.prepare(`INSERT INTO broker_bandwidth_receipts(id,reservation_id,status,payload,created_at)
        VALUES(CASE WHEN changes()=1 THEN ? ELSE NULL END,NULL,'daily_epoch_transition',?,?)`)
        .bind(randomUUID(), JSON.stringify({ oldPolicyHash: plan.oldPolicyHash,
            newPolicyHash: plan.newPolicyHash, witnessHash: plan.witnessHash,
            quoteReserveBytes: plan.quoteReserveBytes, headroomBytes: plan.headroomBytes,
            oldReceiptsPreserved: true }), at));
    const result = await db.batch(statements);
    if ((result.at(-2).meta?.changes ?? result.at(-2).changes) !== 1 ||
        (result.at(-1).meta?.changes ?? result.at(-1).changes) !== 1) {
        throw new Error('broker_daily_migration_raced');
    }
    return { state: 'migrated', policyHash: plan.newPolicyHash,
        witnessHash: plan.witnessHash, quoteReserveBytes: plan.quoteReserveBytes,
        headroomBytes: plan.headroomBytes, oldReceiptsPreserved: true };
}
