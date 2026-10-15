/** 操作者雙階段入口：prepare 刷新既有工作承諾並留來源收據；commit 才寫新政策。 */
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { recordBrokerResetObservation, readBrokerAccountScopeHash }
    from './broker-reset-observation.mjs';
import { buildBrokerDailyResetWitnessFromSavedEvidence }
    from './broker-daily-reset-authority.mjs';
import { planBrokerDailyResetMigration, persistBrokerDailyResetMigration }
    from './broker-daily-reset-migration.mjs';
import { readLocalConservativeIdentity } from './broker-local-conservative-ledger.mjs';
import { readLocalVerifiedDailyIdentity } from './broker-local-verified-reset-ledger.mjs';
import { readScreenerBrokerCommitments }
    from './stock-screener-broker-commitments.mjs';
import { observeRuntimeBudgetAllocations }
    from './stock-screener-runtime-budget-producer.mjs';
import { createScreenerBrokerPorts }
    from './stock-screener-broker-ports.mjs';
import { readDailyMinuteVolumeMode }
    from './intraday-monitor-runtime/daily-minute-volume-postclose.mjs';

const POLICY = 'screener-bollinger-broker-budget-policy';
async function noActiveOwner(root) {
    try {
        await lstat(path.join(root, 'direct-160-live', 'registry', 'active.lock'));
        throw new Error('broker_daily_migration_active_monitor_owner');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}
async function commitmentProof(db, jobKey) {
    const row = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?')
        .bind(`broker-consumer-commitment:${jobKey}`).first();
    if (row?.status !== 'verified') throw new Error('broker_daily_migration_commitment_missing');
    let value = JSON.parse(row.checkpoint);
    if (value.version === 2 && value.receiptId) {
        const saved = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?')
            .bind(value.receiptId).first();
        if (saved?.status !== 'verified') throw new Error('broker_daily_migration_commitment_missing');
        value = JSON.parse(saved.checkpoint);
    }
    return value;
}

export async function prepareBrokerDailyResetActivation({ db, root, beforeEvidenceHash,
    now = () => new Date(), fetchImpl = fetch,
    refreshAllocations = observeRuntimeBudgetAllocations,
    recordAfter = recordBrokerResetObservation,
    buildWitness = buildBrokerDailyResetWitnessFromSavedEvidence } = {}) {
    if (!db?.prepare || !path.isAbsolute(root ?? '') || typeof now !== 'function' ||
        typeof fetchImpl !== 'function' || typeof refreshAllocations !== 'function' ||
        typeof recordAfter !== 'function' || typeof buildWitness !== 'function') {
        throw new TypeError('broker_daily_activation_input_invalid');
    }
    const runtimeMode = (await readDailyMinuteVolumeMode(root)).mode;
    await noActiveOwner(root);
    const row = await db.prepare('SELECT status,checkpoint FROM screener_runs WHERE id=?')
        .bind(POLICY).first();
    if (row?.status !== 'verified') throw new Error('broker_daily_migration_policy_missing');
    const oldPolicy = JSON.parse(row.checkpoint);
    if ((oldPolicy.version === 3 && runtimeMode !== 'legacy') ||
        (oldPolicy.version === 4 && runtimeMode !== 'daily') ||
        ![3, 4].includes(oldPolicy.version)) {
        throw new Error('broker_daily_migration_mode_policy_mismatch');
    }
    const identity = oldPolicy.version === 3
        ? await readLocalConservativeIdentity(db)
        : await readLocalVerifiedDailyIdentity(db);
    if (oldPolicy.scope !== identity.scope ||
        oldPolicy.quotaEpoch !== identity.quotaEpoch ||
        oldPolicy.quotaEpochEvidenceHash !== identity.quotaEpochEvidenceHash ||
        (oldPolicy.version === 4 && oldPolicy.dailyIdentityHash !== identity.identityHash)) {
        throw new Error('broker_daily_migration_policy_identity_invalid');
    }
    const ports = createScreenerBrokerPorts({ db, root, fetchImpl, now });
    await ports.safety();
    const after = await recordAfter({ root, fetchImpl, now });
    const envelope = await buildWitness({ root, beforeEvidenceHash,
        afterEvidenceHash: after.evidenceHash, now: now() });
    await refreshAllocations({ db, record: oldPolicy, root, now: now() });
    await readScreenerBrokerCommitments(db, oldPolicy, now());
    const oldCommitments = await Promise.all(oldPolicy.budgetPolicy.otherConsumerJobKeys
        .map(job => commitmentProof(db, job)));
    const plan = planBrokerDailyResetMigration({ oldPolicy, oldCommitments,
        previousDailyIdentity: oldPolicy.version === 4 ? identity : null,
        witness: envelope.witness, missingRequests: 320, now: now() });
    return Object.freeze({ plan, oldPolicy, oldCommitments,
        previousDailyIdentity: oldPolicy.version === 4 ? identity : null,
        witness: envelope.witness, beforeEvidenceHash,
        afterEvidenceHash: after.evidenceHash, officialEvidenceHash: envelope.officialEvidenceHash,
        simulation: true, admissionAuthority: false });
}

export async function commitBrokerDailyResetActivation({ db, root, prepared,
    now = () => new Date(), fetchImpl = fetch,
    buildWitness = buildBrokerDailyResetWitnessFromSavedEvidence,
    readAccountHash = readBrokerAccountScopeHash } = {}) {
    if (!db?.prepare || !path.isAbsolute(root ?? '') || !prepared ||
        typeof now !== 'function' || typeof fetchImpl !== 'function' ||
        typeof buildWitness !== 'function' || typeof readAccountHash !== 'function') {
        throw new TypeError('broker_daily_activation_commit_invalid');
    }
    const runtimeMode = (await readDailyMinuteVolumeMode(root)).mode;
    if ((prepared.oldPolicy?.version === 3 && runtimeMode !== 'legacy') ||
        (prepared.oldPolicy?.version === 4 && runtimeMode !== 'daily') ||
        ![3, 4].includes(prepared.oldPolicy?.version)) {
        throw new Error('broker_daily_migration_mode_policy_mismatch');
    }
    await noActiveOwner(root);
    const current = await createScreenerBrokerPorts({ db, root, fetchImpl, now }).safety();
    // The witness hash includes observedAt. Rebuild against the exact prepare-time
    // observation rather than a new clock instant; independently require that
    // the prepared witness is still fresh at commit time.
    const preparedAt = new Date(prepared.witness?.proof?.observedAt ?? '');
    const currentAt = now();
    if (!Number.isFinite(preparedAt.valueOf()) ||
        !(currentAt instanceof Date) || !Number.isFinite(currentAt.valueOf()) ||
        currentAt.valueOf() < preparedAt.valueOf() ||
        currentAt.valueOf() - preparedAt.valueOf() > 60_000) {
        throw new Error('broker_daily_migration_witness_expired');
    }
    const envelope = await buildWitness({ root,
        beforeEvidenceHash: prepared.beforeEvidenceHash,
        afterEvidenceHash: prepared.afterEvidenceHash, now: preparedAt });
    if (current.generation !== prepared.witness?.proof?.after?.generation ||
        envelope.witness?.evidenceHash !== prepared.witness.evidenceHash ||
        envelope.officialEvidenceHash !== prepared.officialEvidenceHash ||
        await readAccountHash({ root, fetchImpl }) !== prepared.witness.proof.accountScopeHash) {
        throw new Error('broker_daily_migration_source_changed');
    }
    return persistBrokerDailyResetMigration({ db, plan: prepared.plan,
        previousPolicy: prepared.oldPolicy,
        previousCommitments: prepared.oldCommitments,
        previousDailyIdentity: prepared.previousDailyIdentity,
        witness: prepared.witness, now: now() });
}
